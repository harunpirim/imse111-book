// Pure logic for the Corner Hunter game: two-product linear programs, their
// corner points, and the checks behind the live display. No DOM access, so it
// runs in node --test.
//
// Vocabulary
//   problem     { story, profit: [p1, p2], constraints, xMax, yMax }
//   constraint  { id, name, unit, kind, a, b, op ("<=" or ">="), rhs }
//               meaning a*x + b*y <= rhs (or >=). x and y are the amounts of
//               product 1 and product 2 made per week, both >= 0.
//   corner      { x, y, profit, on: [ids of the lines that meet there] }
//
// The optimum is found the way the chapter teaches it: list every corner of
// the feasible region and take the one with the highest profit.

export const TOL = 1e-7;
export const DECISION_VARIABLES = 2;
export const STAR_SHARES = [0.999, 0.95]; // 3 stars at the optimum, 2 stars within 5% of it

/** The model's simplifying assumptions, shown on the intro and results screens. */
export const ASSUMPTIONS = [
  `${DECISION_VARIABLES === 2 ? "Two" : DECISION_VARIABLES} decision variables (a two-product mix), so the whole problem fits on one graph.`,
  "Profit and resource use are proportional and additive: each unit adds the same profit and uses the same resources, with no interaction between products.",
  "Fractional amounts are allowed (half a unit this week is finished next week).",
  "All coefficients are known with certainty, and variables are non-negative.",
  "Everything made is sold, up to any sales cap shown as its own limit.",
  "One objective: maximize weekly profit. The feasible region is bounded, so a best plan is always at a corner point. When two corners tie, every plan on the edge between them is just as good.",
];

// Each story names the shop, the two products, and what its limits are called.
const STORIES = {
  wood: {
    shop: "Prairie Woodshop",
    x: { name: "cutting boards", short: "boards" },
    y: { name: "step stools", short: "stools" },
    resources: [
      { name: "Saw time", unit: "hours" },
      { name: "Sanding time", unit: "hours" },
      { name: "Finishing time", unit: "hours" },
    ],
  },
  bike: {
    shop: "Red River Cycles",
    x: { name: "city bikes", short: "city bikes" },
    y: { name: "trail bikes", short: "trail bikes" },
    resources: [
      { name: "Assembly time", unit: "hours" },
      { name: "Wheel building", unit: "hours" },
      { name: "Paint booth", unit: "hours" },
    ],
  },
  print: {
    shop: "Layer Lab 3D printing",
    x: { name: "phone stands", short: "stands" },
    y: { name: "desk organizers", short: "organizers" },
    resources: [
      { name: "Printer time", unit: "hours" },
      { name: "Filament", unit: "spools" },
      { name: "Finishing time", unit: "hours" },
    ],
  },
  coffee: {
    shop: "Northern Roast",
    x: { name: "batches of light roast", short: "light batches" },
    y: { name: "batches of dark roast", short: "dark batches" },
    resources: [
      { name: "Roaster time", unit: "hours" },
      { name: "Green beans", unit: "sacks" },
      { name: "Packing time", unit: "hours" },
    ],
  },
  robot: {
    shop: "Bolt and Byte robot kits",
    x: { name: "starter kits", short: "starter kits" },
    y: { name: "pro kits", short: "pro kits" },
    resources: [
      { name: "Soldering time", unit: "hours" },
      { name: "Motor packs", unit: "packs" },
      { name: "Testing time", unit: "hours" },
    ],
  },
};

export const LEVELS = [
  { id: "1", name: "Woodshop", blurb: "2 limits", story: "wood", both: 2 },
  { id: "2", name: "Bike builder", blurb: "3 limits", story: "bike", both: 3 },
  { id: "3", name: "Print lab", blurb: "4 limits · one is a sales cap", story: "print", both: 3, cap: true },
  { id: "4", name: "Coffee roaster", blurb: "3 limits · a tie for first place", story: "coffee", both: 3, tie: true },
  { id: "5", name: "Robot kits", blurb: "4 limits · a minimum order", story: "robot", both: 3, floor: true },
];

// Directions of the sloped edges, from flat to steep. An edge that drops `dy`
// while moving `dx` to the right belongs to the limit dy*x + dx*y <= rhs.
const SLOPES = [
  [3, 1],
  [2, 1],
  [3, 2],
  [1, 1],
  [2, 3],
  [1, 2],
  [1, 3],
];

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

/**
 * Build one candidate problem. The feasible region is drawn first, as a chain
 * of edges between whole-number corners; each edge then becomes one limit.
 * Returns null when the candidate is a poor puzzle (the caller retries).
 */
function candidate(rng, spec) {
  const story = STORIES[spec.story];
  const floor = spec.floor ? rng.int(2, 4) : 0;
  const capOn = spec.cap ? rng.pick(["x", "y"]) : null;

  const slopes = rng
    .shuffle(SLOPES.map((_, i) => i))
    .slice(0, spec.both)
    .sort((a, b) => a - b)
    .map((i) => SLOPES[i]);
  const steps = []; // { dx, dy, a, b, kind }
  if (capOn === "y") steps.push({ dx: rng.int(2, 5), dy: 0, a: 0, b: 1, kind: "cap" });
  for (const [dx, dy] of slopes) {
    const m = rng.int(1, 4);
    steps.push({ dx: dx * m, dy: dy * m, a: dy, b: dx, kind: "resource" });
  }
  if (capOn === "x") steps.push({ dx: 0, dy: rng.int(2, 5), a: 1, b: 0, kind: "cap" });

  const yTop = floor + steps.reduce((s, e) => s + e.dy, 0);
  const xRight = steps.reduce((s, e) => s + e.dx, 0);
  if (xRight < 8 || xRight > 24 || yTop < 8 || yTop > 24) return null;

  // Chain of corners from the y-axis to the floor.
  const chain = [{ x: 0, y: yTop }];
  for (const e of steps) {
    const p = chain[chain.length - 1];
    chain.push({ x: p.x + e.dx, y: p.y - e.dy });
  }

  const constraints = [];
  let r = 0;
  steps.forEach((e, i) => {
    const mult = e.kind === "resource" ? rng.pick([1, 1, 2]) : 1;
    const res = e.kind === "resource" ? story.resources[r++] : null;
    const product = e.a === 1 ? story.x : story.y;
    constraints.push({
      id: constraints.length,
      kind: e.kind,
      name: res ? res.name : `Sales cap, ${product.short}`,
      unit: res ? res.unit : product.short,
      a: e.a * mult,
      b: e.b * mult,
      op: "<=",
      rhs: (e.a * chain[i].x + e.b * chain[i].y) * mult,
    });
  });
  if (spec.floor) {
    constraints.push({ id: constraints.length, kind: "min", name: `Minimum order, ${story.y.short}`, unit: story.y.short, a: 0, b: 1, op: ">=", rhs: floor });
  }

  // Aim the profit so a chosen corner (or a whole edge, for a tie) is best.
  const normal = (e) => [e.a, e.b];
  let dir;
  if (spec.tie) {
    // An inner edge, so both tied corners make some of each product.
    dir = normal(rng.pick(steps.slice(1, -1)));
  } else {
    // Corner i sits between step i-1 and step i. The last corner sits between the last step and the floor.
    const last = steps[steps.length - 1];
    const choices = [];
    for (let i = 1; i < steps.length; i++) choices.push(i);
    // With a minimum order, half the rounds put the optimum on the minimum-order line.
    const i = spec.floor && last.b >= 1 && rng.chance(0.5) ? steps.length : rng.pick(choices);
    const alpha = rng.int(1, 3);
    const beta = rng.int(1, 3);
    const n1 = normal(steps[i - 1]);
    const n2 = i < steps.length ? normal(steps[i]) : [0, -1];
    dir = [alpha * n1[0] + beta * n2[0], alpha * n1[1] + beta * n2[1]];
  }
  if (dir[0] <= 0 || dir[1] <= 0) return null;
  const g = gcd(dir[0], dir[1]);
  const unit = [dir[0] / g, dir[1] / g];
  // Dollar amounts students can work with: the larger unit profit lands between $20 and $100.
  const scales = [5, 10, 15, 20, 25, 30, 40, 50].filter((k) => Math.max(...unit) * k >= 20 && Math.max(...unit) * k <= 100);
  if (!scales.length) return null;
  const scale = rng.pick(scales);
  const profit = [unit[0] * scale, unit[1] * scale];

  const problem = {
    story,
    profit,
    constraints,
    xMax: niceMax(xRight),
    yMax: niceMax(yTop),
  };

  // Keep only clear puzzles: every limit matters, and the winner is not a photo finish.
  const sol = solve(problem);
  if (sol.corners.length !== chain.length + 1) return null; // the chain plus the corner at (0, floor)
  const sorted = sol.corners.map((c) => c.profit).sort((a, b) => b - a);
  const runnerUp = sorted[spec.tie ? 2 : 1];
  if (sol.optimal.length !== (spec.tie ? 2 : 1)) return null;
  if (runnerUp > sol.best * 0.97) return null;
  if (!spec.floor && isOptimal(problem, greedyPlan(problem))) return null; // the rule of thumb should miss
  return problem;
}

/** Axis length: a little beyond the largest corner, rounded up to an even number. */
function niceMax(v) {
  return Math.ceil((v * 1.12 + 1) / 2) * 2;
}

/** Fallback problems, one per level, used only if random search fails (it should not). */
function fallback(spec) {
  const story = STORIES[spec.story];
  const res = (i, a, b, rhs) => ({ id: i, kind: "resource", name: story.resources[i].name, unit: story.resources[i].unit, a, b, op: "<=", rhs });
  return { story, profit: [30, 40], constraints: [res(0, 1, 2, 20), res(1, 1, 1, 12), res(2, 2, 1, 20)].slice(0, Math.max(2, spec.both)), xMax: 14, yMax: 14 };
}

/**
 * Generate a level's problem from the round's random numbers.
 * @param {object} rng   from shared/rng.js
 * @param {object} spec  one of LEVELS
 */
export function generateProblem(rng, spec) {
  for (let attempt = 1; attempt <= 400; attempt++) {
    const p = candidate(rng, spec);
    if (p) return { ...p, attempts: attempt };
  }
  return { ...fallback(spec), attempts: 0 };
}

/** Left-hand side of a constraint at a plan: how much of the resource the plan uses. */
export function usage(c, x, y) {
  return c.a * x + c.b * y;
}

export function profitAt(problem, x, y) {
  return problem.profit[0] * x + problem.profit[1] * y;
}

/**
 * Check a plan against every limit.
 * state is "binding" (exactly at the limit), "slack" (room left), or "violated".
 * slack is the room left (negative when violated).
 */
export function check(problem, x, y, tol = 1e-6) {
  const rows = problem.constraints.map((c) => {
    const used = usage(c, x, y);
    const slack = c.op === "<=" ? c.rhs - used : used - c.rhs;
    const state = slack < -tol ? "violated" : slack <= tol ? "binding" : "slack";
    return { id: c.id, used, slack: Math.abs(slack) <= tol ? 0 : slack, state };
  });
  const nonNegative = x >= -tol && y >= -tol;
  return {
    rows,
    nonNegative,
    feasible: nonNegative && rows.every((r) => r.state !== "violated"),
    binding: rows.filter((r) => r.state === "binding").map((r) => r.id),
    violated: rows.filter((r) => r.state === "violated").map((r) => r.id),
    profit: profitAt(problem, x, y),
  };
}

/** Every boundary line: the limits, then the two axes (ids "x-axis" and "y-axis"). */
function boundaryLines(problem) {
  return [
    ...problem.constraints.map((c) => ({ id: c.id, a: c.a, b: c.b, rhs: c.rhs })),
    { id: "y-axis", a: 1, b: 0, rhs: 0 }, // x = 0
    { id: "x-axis", a: 0, b: 1, rhs: 0 }, // y = 0
  ];
}

/**
 * Corner points of the feasible region: intersect every pair of boundary
 * lines, keep the feasible intersections, and order them counter-clockwise.
 */
export function cornerPoints(problem) {
  const L = boundaryLines(problem);
  const pts = [];
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) {
      const det = L[i].a * L[j].b - L[j].a * L[i].b;
      if (Math.abs(det) < 1e-12) continue; // parallel lines never meet
      let x = (L[i].rhs * L[j].b - L[j].rhs * L[i].b) / det;
      let y = (L[i].a * L[j].rhs - L[j].a * L[i].rhs) / det;
      if (Math.abs(x) < 1e-9) x = 0;
      if (Math.abs(y) < 1e-9) y = 0;
      if (!check(problem, x, y).feasible) continue;
      const same = pts.find((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
      if (same) {
        for (const id of [L[i].id, L[j].id]) if (!same.on.includes(id)) same.on.push(id);
      } else {
        pts.push({ x, y, on: [L[i].id, L[j].id] });
      }
    }
  }
  const cx = pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1);
  const cy = pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1);
  pts.sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
  return pts.map((p) => ({ ...p, profit: profitAt(problem, p.x, p.y) }));
}

/** Solve by corner enumeration: { corners, best, optimal: [corners that reach best] }. */
export function solve(problem) {
  const corners = cornerPoints(problem);
  const best = corners.length ? Math.max(...corners.map((c) => c.profit)) : -Infinity;
  const optimal = corners.filter((c) => c.profit >= best - 1e-6 * Math.max(1, Math.abs(best)));
  return { corners, best, optimal };
}

/** True when a feasible plan earns the best possible profit. */
export function isOptimal(problem, plan) {
  const sol = solve(problem);
  return check(problem, plan.x, plan.y).feasible && profitAt(problem, plan.x, plan.y) >= sol.best - 1e-6 * Math.max(1, sol.best);
}

/**
 * The tempting rule of thumb: make as many as possible of the product with the
 * higher profit per unit, then use what is left for the other product.
 * (A tie in unit profit goes to product 1.)
 */
export function greedyPlan(problem) {
  const first = problem.profit[1] > problem.profit[0] ? "y" : "x";
  const second = first === "x" ? "y" : "x";
  const corners = cornerPoints(problem);
  const top = Math.max(...corners.map((c) => c[first]));
  const pick = corners.filter((c) => c[first] >= top - 1e-6).sort((p, q) => q[second] - p[second])[0];
  return { x: pick.x, y: pick.y, profit: pick.profit, first };
}

/** How much the best profit rises if one limit gets one more unit (its value at the margin). */
export function valueOfOneMore(problem, id) {
  const more = { ...problem, constraints: problem.constraints.map((c) => (c.id === id ? { ...c, rhs: c.rhs + 1 } : c)) };
  return solve(more).best - solve(problem).best;
}

/** The best profit if one limit did not exist (used to price a minimum order). */
export function bestWithout(problem, id) {
  const fewer = { ...problem, constraints: problem.constraints.filter((c) => c.id !== id) };
  return solve(fewer).best;
}

/** The limit whose line is parallel to the profit line, if any (the cause of a tie). */
export function parallelConstraint(problem) {
  const [p1, p2] = problem.profit;
  return problem.constraints.find((c) => c.a > 0 && c.b > 0 && Math.abs(c.a * p2 - c.b * p1) < 1e-9) || null;
}

/**
 * Magnetic snapping for the drag handle. Distances are measured in screen
 * pixels (sx, sy = pixels per unit) so the pull feels the same on both axes.
 * Order: nearest corner within `cornerPx`, else nearest boundary within
 * `edgePx`, else the plan rounded to 0.1.
 */
export function snapPoint(problem, x, y, sx, sy, cornerPx = 12, edgePx = 7) {
  const clampX = (v) => Math.min(problem.xMax, Math.max(0, v));
  const clampY = (v) => Math.min(problem.yMax, Math.max(0, v));
  x = clampX(x);
  y = clampY(y);
  let best = null;
  for (const c of cornerPoints(problem)) {
    const d = Math.hypot((c.x - x) * sx, (c.y - y) * sy);
    if (d <= cornerPx && (!best || d < best.d)) best = { d, x: c.x, y: c.y };
  }
  if (best) return { x: best.x, y: best.y, snapped: "corner" };
  for (const l of boundaryLines(problem)) {
    // Closest point on the line a*x + b*y = rhs, in pixel space.
    const A = l.a / sx;
    const B = l.b / sy;
    const norm = A * A + B * B;
    const t = (l.a * x + l.b * y - l.rhs) / norm;
    const qx = x - (t * A) / sx;
    const qy = y - (t * B) / sy;
    const d = Math.abs(t) * Math.sqrt(norm);
    if (d > edgePx || qx < -1e-9 || qy < -1e-9 || qx > problem.xMax + 1e-9 || qy > problem.yMax + 1e-9) continue;
    if (!check(problem, qx, qy).feasible) continue;
    if (!best || d < best.d) best = { d, x: qx, y: qy, line: l };
  }
  if (best) {
    // Keep one coordinate tidy (0.1 steps) and take the other from the line.
    const l = best.line;
    let px = Math.round(best.x * 10) / 10;
    let py = Math.round(best.y * 10) / 10;
    if (Math.abs(l.b) > 1e-12) py = (l.rhs - l.a * px) / l.b;
    else px = l.rhs / l.a;
    if (check(problem, px, py).feasible && py >= 0 && py <= problem.yMax) return { x: Math.max(0, px), y: Math.max(0, py), snapped: "edge" };
    return { x: Math.max(0, best.x), y: Math.max(0, best.y), snapped: "edge" };
  }
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, snapped: null };
}

/** Stars for a feasible plan: 3 = the optimum, 2 = within 5% of it, 1 = feasible. */
export function starsFor(profit, best) {
  const share = best > 0 ? profit / best : 0;
  if (share >= STAR_SHARES[0]) return 3;
  if (share >= STAR_SHARES[1]) return 2;
  return 1;
}

/** "2x + 3y ≤ 24" with the products' own symbols left out when a coefficient is 0. */
export function formula(c) {
  const term = (k, v) => (k === 0 ? null : `${k === 1 ? "" : k}${v}`);
  const lhs = [term(c.a, "x"), term(c.b, "y")].filter(Boolean).join(" + ");
  return `${lhs} ${c.op === "<=" ? "≤" : "≥"} ${c.rhs}`;
}
