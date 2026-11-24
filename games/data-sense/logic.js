// Pure logic for Data Sense: summary statistics, Pearson's r, the two outlier
// rules, the made-up datasets for each level, and scoring. No DOM access.

export const GUESS_STEP = 0.05; // the slider moves in steps of this size
export const CLOSE = 0.1; // a guess within this of r is "close" and keeps a streak alive
export const ZERO_POINTS_AT = 0.5; // a guess this far from r (or more) scores no points
export const IQR_K = 1.5; // fences sit this many IQRs beyond the quartiles
export const Z_LIMIT = 3; // the 3-sigma rule: more than this many standard deviations from the mean
export const CURVE_R_MAX = 0.12; // curved trap plots are redrawn until |r| is at most this
export const MAX_OUTLIERS = 3; // outlier-level datasets are redrawn until the rule flags at most this many

/**
 * The model's simplifying assumptions, shown on the intro and results screens.
 * Numbers come from the constants in this file so the text can't drift from the code.
 */
export const ASSUMPTIONS = [
  "Every dataset is invented for the game. Each scatter is a sample of independent (x, y) pairs with no measurement error. On the trap and outlier levels, one or two points may be planted on purpose, or only a narrow slice of x values is sampled.",
  "Pearson's r measures straight-line association only, from −1 to +1. A strong curved pattern can still give r near 0.",
  `An outlier is defined by a fixed rule: beyond ${IQR_K} × IQR from the quartiles (Levels 4 and 6), or more than ${Z_LIMIT} standard deviations from the mean (Level 5). Outliers can move r, the mean, and the standard deviation a lot.`,
  "On a scatter plot, a point is flagged when its x value or its y value breaks the rule. A point that is only far from the trend, but ordinary on both axes, is not flagged.",
  "Quartiles are found by linear interpolation (the default in Excel's QUARTILE.INC and in numpy). The standard deviation is the sample one, dividing by n − 1.",
  `Scoring: a guess within ${CLOSE.toFixed(2)} of the computed r is close; a guess ${ZERO_POINTS_AT.toFixed(2)} or more away earns no points. Outlier picks earn full marks only when they match the rule exactly.`,
  "Correlation doesn't imply causation. A strong r says two measurements move together, not that one causes the other.",
];

// ---------------------------------------------------------------- statistics

export function mean(a) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}

/** Sample standard deviation (divides by n − 1). */
export function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** Quantile by linear interpolation between order statistics (numpy default, Excel QUARTILE.INC). */
export function quantile(a, p) {
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.min(s.length - 1, lo + 1);
  return s[lo] + (pos - lo) * (s[hi] - s[lo]);
}

export function median(a) {
  return quantile(a, 0.5);
}

/** Pearson's correlation coefficient. Returns 0 when either variable doesn't vary. */
export function pearson(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** Least-squares line y = intercept + slope × x. */
export function leastSquares(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** Quartiles, IQR, and the fences of the 1.5 × IQR rule. */
export function fences(a, k = IQR_K) {
  const q1 = quantile(a, 0.25);
  const q3 = quantile(a, 0.75);
  const iqr = q3 - q1;
  return { q1, q3, iqr, lo: q1 - k * iqr, hi: q3 + k * iqr };
}

/** Indices of values beyond the 1.5 × IQR fences. */
export function iqrOutliers(a, k = IQR_K) {
  const f = fences(a, k);
  return a.map((v, i) => (v < f.lo || v > f.hi ? i : -1)).filter((i) => i >= 0);
}

export function zScores(a) {
  const m = mean(a);
  const s = sd(a);
  return a.map((v) => (s === 0 ? 0 : (v - m) / s));
}

/** Indices of values more than `limit` standard deviations from the mean. */
export function zOutliers(a, limit = Z_LIMIT) {
  return zScores(a)
    .map((z, i) => (Math.abs(z) > limit ? i : -1))
    .filter((i) => i >= 0);
}

/** Scatter rule: a point is an outlier when its x or its y is beyond that axis's fences. */
export function fenceBoxOutliers(points, k = IQR_K) {
  const ox = new Set(iqrOutliers(points.map((p) => p.x), k));
  const oy = new Set(iqrOutliers(points.map((p) => p.y), k));
  return points.map((_, i) => i).filter((i) => ox.has(i) || oy.has(i));
}

const rOf = (pts) => pearson(pts.map((p) => p.x), pts.map((p) => p.y));
const without = (arr, drop) => {
  const d = new Set(drop);
  return arr.filter((_, i) => !d.has(i));
};
const round = (v, dp) => Number(v.toFixed(dp));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Mean, median, and standard deviation with all values and with some removed. */
export function summaryWithout(values, drop) {
  const rest = without(values, drop);
  const s = (a) => ({ n: a.length, mean: mean(a), median: median(a), sd: sd(a) });
  return { all: s(values), kept: s(rest.length ? rest : values) };
}

/** A plain-language label for a correlation, e.g. "strong positive". */
export function describeR(r) {
  const a = Math.abs(r);
  if (a < 0.1) return "no straight-line relationship";
  const size = a < 0.3 ? "weak" : a < 0.6 ? "moderate" : a < 0.8 ? "fairly strong" : "strong";
  return `${size} ${r > 0 ? "positive" : "negative"}`;
}

// ---------------------------------------------------------------- stories

const ax = (label, unit, min, max, dp = 0) => ({ label, unit, min, max, dp });

/**
 * Invented IE settings for the scatter plots. `sign` is the direction the
 * relationship naturally has; `things` is what one point stands for.
 */
export const STORIES = {
  pos: [
    { id: "age-downtime", things: "machines", x: ax("Machine age", "years", 1, 15, 1), y: ax("Downtime", "hours per month", 2, 30, 1) },
    { id: "order-pick", things: "orders", x: ax("Order size", "items", 5, 60), y: ax("Picking time", "min", 3, 40, 1) },
    { id: "study-score", things: "students", x: ax("Study time", "hours per week", 0, 20, 1), y: ax("Exam score", "points", 40, 100) },
    { id: "speed-defects", things: "shifts", x: ax("Line speed", "units per hour", 40, 120), y: ax("Defects", "per 1,000 units", 2, 30, 1) },
    { id: "load-unload", things: "deliveries", x: ax("Truck load", "pallets", 4, 26), y: ax("Unloading time", "min", 10, 70) },
  ],
  neg: [
    { id: "experience-time", things: "operators", x: ax("Operator experience", "months", 1, 36), y: ax("Assembly time", "s", 40, 120) },
    { id: "training-errors", things: "new hires", x: ax("Training", "hours", 0, 40), y: ax("Errors", "per week", 0, 20) },
    { id: "maintenance-breakdowns", things: "machines", x: ax("Maintenance budget", "$1,000 per year", 5, 50), y: ax("Breakdowns", "per year", 0, 24) },
  ],
  none: [
    { id: "badge-packed", things: "employees", x: ax("Employee badge number", "", 1000, 9999), y: ax("Parts packed", "per hour", 20, 60) },
    { id: "day-scrap", things: "days", x: ax("Day of the month", "", 1, 30), y: ax("Scrap", "kg", 5, 45) },
    { id: "height-inspected", things: "operators", x: ax("Operator height", "cm", 150, 195), y: ax("Parts inspected", "per hour", 30, 90) },
  ],
  // Strongly correlated, but a third factor drives both.
  lurking: [
    {
      id: "fans-drinks",
      things: "days",
      x: ax("Fans switched on", "", 0, 40),
      y: ax("Cold drinks sold", "per day", 10, 120),
      why: "Both go up on hot days. Switching on a fan doesn't sell a drink: the weather drives both.",
    },
    {
      id: "coffee-shipped",
      things: "days",
      x: ax("Coffee brewed", "cups per day", 20, 200),
      y: ax("Units shipped", "per day", 300, 1500),
      why: "Both go up when more people are on shift. Brewing more coffee won't ship more units: the crew size drives both.",
    },
  ],
  // A strong pattern that is not a straight line.
  curve: [
    {
      id: "oven-defects",
      things: "batches",
      shape: "valley",
      x: ax("Oven temperature", "°C", 160, 240),
      y: ax("Defects", "%", 1, 15, 1),
      why: "Too cold or too hot both cause defects, so the points make a U.",
    },
    {
      id: "speed-cost",
      things: "test cuts",
      shape: "valley",
      x: ax("Cutting speed", "m/min", 50, 250),
      y: ax("Cost per part", "$", 2, 8, 2),
      why: "Slow cutting wastes labor time and fast cutting wears out tools, so cost is lowest in the middle.",
    },
    {
      id: "workload-quality",
      things: "shifts",
      shape: "hill",
      x: ax("Workload", "tasks per hour", 2, 20, 1),
      y: ax("Quality score", "points", 50, 100),
      why: "Bored workers and overloaded workers both slip, so quality peaks in the middle.",
    },
  ],
};

/** Strength bands for honest (non-trap) plots: the range the true correlation is drawn from. */
export const BANDS = {
  strong: [0.85, 0.97],
  solid: [0.6, 0.8],
  medium: [0.4, 0.6],
  weak: [0.15, 0.35],
  none: [0, 0],
};

/** One-variable settings for the dot-plot levels. `skew: true` settings have a long right tail. */
export const SERIES = [
  { id: "cycle", label: "Cycle time at a packing station", unit: "s", center: 42, spread: 3, dp: 1 },
  { id: "fill", label: "Fill weight of a cereal box", unit: "g", center: 500, spread: 6, dp: 0 },
  { id: "torque", label: "Bolt tightening torque", unit: "N·m", center: 60, spread: 2, dp: 1 },
  { id: "diameter", label: "Shaft diameter", unit: "mm", center: 25, spread: 0.02, dp: 3 },
  { id: "scrap", label: "Daily scrap", unit: "kg", center: 30, spread: 5, dp: 0 },
  { id: "delivery", label: "Supplier delivery time", unit: "days", center: 3, spread: 3, dp: 0, skew: true },
  { id: "wait", label: "Wait for a forklift", unit: "min", center: 2, spread: 4, dp: 1, skew: true },
];

export const LEVELS = [
  { id: "1", mode: "guess", name: "Guess r: clear trends", blurb: "5 plots, strong or none", n: 40, plan: ["strong", "strong", "solid", "solid", "none"] },
  { id: "2", mode: "guess", name: "Guess r: subtle", blurb: "5 plots, fewer points", n: 25, plan: ["solid", "medium", "medium", "weak", "none"] },
  { id: "3", mode: "guess", name: "Guess r: traps", blurb: "6 plots, look twice", n: 30, plan: ["curve", "makes", "breaks", "restricted", "lurking", "medium"] },
  { id: "4", mode: "outlier", rule: "iqr", name: "Find the Outlier: box-plot rule", blurb: "4 dot plots, 1.5 × IQR", plan: ["high", "both", "skew", "near", "none"], take: 4 },
  { id: "5", mode: "outlier", rule: "z", name: "Find the Outlier: 3-sigma rule", blurb: "3 dot plots, |z| > 3", plan: ["far", "masked", "moderate"], take: 3 },
  { id: "6", mode: "outlier", rule: "box", name: "Find the Outlier: scatter", blurb: "3 scatter plots, watch r", n: 24, plan: ["makes", "breaks", "clean"], take: 3 },
];

// ---------------------------------------------------------------- scatter data

/** Turn a standard score into a value on a story axis (about ±2.6 sd spans the axis). */
function scale(axis, z) {
  const mid = (axis.min + axis.max) / 2;
  const unit = (axis.max - axis.min) / 5.2;
  return round(clamp(mid + z * unit, axis.min, axis.max), axis.dp);
}

function finish(kind, story, sign, points, extra = {}) {
  return { kind, story, sign, points, n: points.length, r: rOf(points), ...extra };
}

/** An honest linear sample with true correlation sign × rho. */
function linearCase(rng, kind, story, sign, rho, n) {
  const points = [];
  for (let i = 0; i < n; i++) {
    const zx = rng.normal();
    const zy = sign * rho * zx + Math.sqrt(1 - rho * rho) * rng.normal();
    points.push({ x: scale(story.x, zx), y: scale(story.y, zy) });
  }
  return finish(kind, story, sign, points, { rho: sign * rho });
}

/** No relationship: x spread evenly over its range, y unrelated to it. */
function noneCase(rng, story, n) {
  const points = [];
  for (let i = 0; i < n; i++) {
    points.push({ x: round(rng.uniform(story.x.min, story.x.max), story.x.dp), y: scale(story.y, rng.normal()) });
  }
  return finish("none", story, 0, points, { rho: 0 });
}

/** Height of the generating curve (0 to 1 of the y axis) at t in [-1, 1]. */
export function curveShape(shape, t) {
  return shape === "hill" ? 0.88 - 0.74 * t * t : 0.14 + 0.74 * t * t;
}

/** The curve a "curve" case was generated from, as y for a given x. */
export function curveY(story, x) {
  const mid = (story.x.min + story.x.max) / 2;
  const half = (story.x.max - story.x.min) / 2;
  return story.y.min + (story.y.max - story.y.min) * curveShape(story.shape, (x - mid) / half);
}

/** A strong U (or upside-down U): clear pattern, r near 0. Redrawn until |r| <= CURVE_R_MAX. */
function curveCase(rng, story, n) {
  const span = story.y.max - story.y.min;
  let best = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const points = [];
    for (let i = 0; i < n; i++) {
      const x = round(rng.uniform(story.x.min, story.x.max), story.x.dp);
      const y = round(clamp(curveY(story, x) + rng.normal(0, 0.05 * span), story.y.min, story.y.max), story.y.dp);
      points.push({ x, y });
    }
    const c = finish("curve", story, 0, points);
    if (!best || Math.abs(c.r) < Math.abs(best.r)) best = c;
    if (Math.abs(c.r) <= CURVE_R_MAX) break;
  }
  return best;
}

/** An unrelated cloud plus one far corner point that creates a correlation. */
function makesCase(rng, story, sign, n) {
  const points = [];
  for (let i = 0; i < n - 1; i++) {
    points.push({ x: scale(story.x, -0.7 + 0.45 * rng.normal()), y: scale(story.y, sign * -0.7 + 0.45 * rng.normal()) });
  }
  points.push({ x: scale(story.x, rng.uniform(2.1, 2.5)), y: scale(story.y, sign * rng.uniform(2.1, 2.5)) });
  return withPlanted("makes", story, sign, rng.shuffle(points.map((p, i) => ({ ...p, planted: i === n - 1 }))));
}

/** A tight linear trend plus one far off-trend point that weakens the correlation. */
function breaksCase(rng, story, sign, n) {
  const rho = rng.uniform(0.88, 0.95);
  const points = [];
  for (let i = 0; i < n - 1; i++) {
    const zx = rng.normal();
    const zy = sign * rho * zx + Math.sqrt(1 - rho * rho) * rng.normal();
    points.push({ x: scale(story.x, -0.3 + 0.6 * zx), y: scale(story.y, sign * -0.3 + 0.6 * zy) });
  }
  // Far along x, and on the wrong side of the trend in y.
  points.push({ x: scale(story.x, rng.uniform(2.1, 2.5)), y: scale(story.y, -sign * rng.uniform(2.0, 2.4)) });
  return withPlanted("breaks", story, sign, rng.shuffle(points.map((p, i) => ({ ...p, planted: i === n - 1 }))));
}

function withPlanted(kind, story, sign, tagged) {
  const points = tagged.map(({ x, y }) => ({ x, y }));
  const planted = tagged.findIndex((p) => p.planted);
  return finish(kind, story, sign, points, { planted, rWithout: rOf(without(points, [planted])) });
}

/** A strong trend across the full range, but only a narrow slice of x was sampled. */
function restrictedCase(rng, story, sign, n) {
  const rho = rng.uniform(0.8, 0.9);
  const center = rng.uniform(-0.5, 0.5);
  const half = 0.4;
  const population = [];
  const points = [];
  // Draw until the slice holds n points (about a third of all draws land in it)
  // and at least twice as many lie outside it. Extra draws inside the slice are dropped.
  for (let guard = 0; (points.length < n || population.length < 2 * n) && guard < 5000; guard++) {
    const zx = rng.normal();
    const zy = sign * rho * zx + Math.sqrt(1 - rho * rho) * rng.normal();
    const p = { x: scale(story.x, zx), y: scale(story.y, zy) };
    if (Math.abs(zx - center) > half) population.push(p);
    else if (points.length < n) points.push(p);
  }
  const xs = points.map((p) => p.x);
  return finish("restricted", story, sign, points, {
    outside: population,
    rFull: rOf([...points, ...population]),
    window: [Math.min(...xs), Math.max(...xs)],
  });
}

/** Choose a story for a kind of plot and return a function that draws a sample for it. */
function scatterMaker(rng, kind, n, pools) {
  const signed = () => {
    // Mostly positive stories; fall back to the other list when one runs out.
    const wantPos = rng.chance(0.6);
    const usePos = (wantPos && pools.pos.length > 0) || pools.neg.length === 0;
    return usePos ? { story: pools.pos.pop(), sign: 1 } : { story: pools.neg.pop(), sign: -1 };
  };
  if (kind === "none" || kind === "curve" || kind === "lurking") {
    const story = pools[kind].pop();
    if (kind === "none") return () => noneCase(rng, story, n);
    if (kind === "curve") return () => curveCase(rng, story, n);
    return () => linearCase(rng, "lurking", story, 1, rng.uniform(0.8, 0.92), n);
  }
  const { story, sign } = signed();
  if (kind === "makes") return () => makesCase(rng, story, sign, n);
  if (kind === "breaks") return () => breaksCase(rng, story, sign, n);
  if (kind === "restricted") return () => restrictedCase(rng, story, sign, n);
  if (kind === "clean") return () => linearCase(rng, "clean", story, sign, rng.uniform(0.5, 0.7), n);
  const [lo, hi] = BANDS[kind];
  return () => linearCase(rng, kind, story, sign, rng.uniform(lo, hi), n);
}

/** Redraw until `ok(item)` holds, giving up (and keeping the last draw) after 60 tries. */
function drawUntil(draw, ok) {
  let item = draw();
  for (let i = 0; i < 60 && !ok(item); i++) item = draw();
  return item;
}

// ---------------------------------------------------------------- one-variable data

/** A small one-variable dataset. `kind` is what was planted; the rule decides what counts. */
function makeSeries(rng, kind, series, rule) {
  const big = rule === "z";
  const n = big ? (kind === "masked" ? rng.int(20, 24) : rng.int(24, 30)) : rng.int(12, 16);
  const { center, spread, dp } = series;
  const values = [];
  const push = (v) => values.push(round(Math.max(0, v), dp));
  const planted = { high: [1], both: [1, -1], far: [1], masked: [1, 1], moderate: [1], near: [1], none: [], skew: [] }[kind];
  const base = n - planted.length;
  for (let i = 0; i < base; i++) {
    // Skewed settings: a floor plus a long right tail. Others: a bell shape.
    push(series.skew ? center + spread * Math.exp(rng.normal(0, 0.75)) - spread * 0.5 : rng.normal(center, spread));
  }
  const reach = { high: [5, 8], both: [5, 8], far: [7, 9], masked: [5, 5.8], moderate: [3.3, 3.8], near: [2.0, 2.4] }[kind];
  const side = kind === "both" ? 1 : rng.pick([1, -1]);
  planted.forEach((dir) => push(center + side * dir * spread * rng.uniform(reach[0], reach[1])));
  const shuffled = rng.shuffle(values);
  return { kind, series, rule, values: shuffled, n: shuffled.length, outliers: rule === "z" ? zOutliers(shuffled) : iqrOutliers(shuffled) };
}

// ---------------------------------------------------------------- rounds

/** Build one round for a level: a list of plots (guess mode) or datasets (outlier mode). */
export function generateRound(rng, level) {
  const pools = Object.fromEntries(Object.entries(STORIES).map(([k, list]) => [k, rng.shuffle(list)]));
  const kinds = rng.shuffle(level.plan).slice(0, level.take || level.plan.length);
  if (level.mode === "guess") {
    return { mode: "guess", items: kinds.map((kind) => scatterMaker(rng, kind, level.n, pools)()) };
  }
  // Outlier levels: keep the answer small enough to tap, and make sure a planted point is one the rule flags.
  const few = (it) => it.outliers.length <= MAX_OUTLIERS;
  if (level.rule === "box") {
    const items = kinds.map((kind) => {
      const draw = scatterMaker(rng, kind, level.n, pools);
      return drawUntil(
        () => {
          const c = draw();
          const outliers = fenceBoxOutliers(c.points);
          return { ...c, rule: "box", outliers, rKept: rOf(without(c.points, outliers)) };
        },
        (it) => few(it) && (it.planted === undefined || it.outliers.includes(it.planted)),
      );
    });
    return { mode: "outlier", rule: "box", items };
  }
  const normal = rng.shuffle(SERIES.filter((s) => !s.skew));
  const skewed = rng.shuffle(SERIES.filter((s) => s.skew));
  const items = kinds.map((kind) => {
    const series = kind === "skew" ? skewed.pop() : normal.pop();
    return drawUntil(() => makeSeries(rng, kind, series, level.rule), few);
  });
  return { mode: "outlier", rule: level.rule, items };
}

// ---------------------------------------------------------------- scoring

/** Round a slider position to the slider's step, avoiding floating-point dust. */
export function snapGuess(v) {
  return round(clamp(Math.round(v / GUESS_STEP) * GUESS_STEP, -1, 1), 2);
}

/** Points for one guess: 100 for a perfect guess, falling in a straight line to 0 at ZERO_POINTS_AT. */
export function guessPoints(guess, r) {
  return Math.max(0, Math.round(100 * (1 - Math.abs(guess - r) / ZERO_POINTS_AT)));
}

export function isClose(guess, r) {
  return Math.abs(guess - r) <= CLOSE + 1e-9;
}

/** Totals for a list of { guess, r }. */
export function guessSummary(items) {
  let streak = 0;
  let longest = 0;
  let points = 0;
  let close = 0;
  let errorSum = 0;
  for (const it of items) {
    errorSum += Math.abs(it.guess - it.r);
    points += guessPoints(it.guess, it.r);
    if (isClose(it.guess, it.r)) {
      close += 1;
      streak += 1;
      longest = Math.max(longest, streak);
    } else streak = 0;
  }
  return { count: items.length, meanError: items.length ? errorSum / items.length : 0, points, close, longestStreak: longest, streak };
}

/** Stars for Guess r: 3 = average error within CLOSE, then 0.20 and 0.35. */
export function starsForGuess(meanError) {
  if (meanError <= CLOSE + 1e-9) return 3;
  if (meanError <= 0.2) return 2;
  if (meanError <= 0.35) return 1;
  return 0;
}

/**
 * Compare the player's picks with the rule's outliers (both are index lists).
 * score = shared picks / all picks made by either side, so 1 means an exact match.
 */
export function scorePicks(picked, truth) {
  const p = new Set(picked);
  const t = new Set(truth);
  const hits = [...p].filter((i) => t.has(i)).length;
  const extra = p.size - hits;
  const missed = t.size - hits;
  const union = hits + extra + missed;
  return { hits, extra, missed, exact: extra === 0 && missed === 0, score: union === 0 ? 1 : hits / union };
}

/** Stars for Find the Outlier from the average pick score. */
export function starsForPicks(avgScore) {
  if (avgScore >= 0.999) return 3;
  if (avgScore >= 0.7) return 2;
  if (avgScore >= 0.4) return 1;
  return 0;
}
