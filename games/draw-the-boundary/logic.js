// Pure logic for Draw the Boundary: the hidden process that makes the data,
// the player's hand-drawn boundary, the fitted benchmark models (logistic
// regression and k-nearest neighbors), and error rates. No DOM access.
//
// All geometry is in plot units: both features run from 0 to 1. The UI turns
// them into vibration (mm/s) and temperature (°C) with the AXES below.

export const AXES = {
  x: { label: "Vibration", unit: "mm/s", min: 0, max: 10, dp: 1 },
  y: { label: "Bearing temperature", unit: "°C", min: 40, max: 100, dp: 0 },
};
export const CLASSES = ["healthy", "fails"]; // label 0 and label 1
export const TEST_SIZE = 200; // hidden test machines on the drawing levels
export const SLIDER_TEST_SIZE = 400; // hidden test machines on the complexity level
export const MAX_BENDS = 12; // interior control points the player may add
export const CV_FOLDS = 5; // folds used to pick the fitted model's shape
export const KS = [45, 31, 21, 15, 11, 7, 5, 3, 1]; // k for k-NN, from simplest to most complex
export const STAR_GAPS = [0.01, 0.05, 0.1]; // test-error gap to the benchmark for 3, 2, 1 stars

const pctText = (p) => `${Math.round(p * 100)}%`;

export const LEVELS = [
  { id: "1", mode: "draw", name: "Clean split", blurb: "30 machines, no noise", truth: "line", noise: 0, margin: 0.06, nTrain: 30 },
  { id: "2", mode: "draw", name: "Noisy records", blurb: "40 machines, 10% wrong labels", truth: "line", noise: 0.1, margin: 0, nTrain: 40 },
  { id: "3", mode: "draw", name: "Tempting wiggles", blurb: "24 machines, 20% wrong labels", truth: "line", noise: 0.2, margin: 0, nTrain: 24 },
  { id: "4", mode: "draw", name: "Curved truth", blurb: "a straight line is too simple", truth: "valley", noise: 0.05, margin: 0, nTrain: 50 },
  { id: "5", mode: "two", name: "Small vs. large", blurb: "12 machines, then 120", truth: "valley", noise: 0.1, margin: 0, nTrain: 120, nSmall: 12 },
  { id: "6", mode: "slider", name: "Complexity slider", blurb: "the computer fits, you choose", truth: "valley", noise: 0.15, margin: 0, nTrain: 60, nVal: 40 },
];

const noises = LEVELS.map((l) => l.noise);

/**
 * The model's simplifying assumptions, shown on the intro and results screens.
 * Numbers come from the constants in this file so the text can't drift from the code.
 */
export const ASSUMPTIONS = [
  `Two numeric features (${AXES.x.label.toLowerCase()} and ${AXES.y.label.toLowerCase()}) and two classes (a machine stays healthy, or fails within a month). The machines are invented and spread evenly over the plot.`,
  `Training and test points are independent draws from the same process. Labels follow a hidden true rule, except for a stated share of records (${pctText(Math.min(...noises))} to ${pctText(Math.max(...noises))}, depending on the level) whose label is flipped at random.`,
  `The test set (${TEST_SIZE} machines, or ${SLIDER_TEST_SIZE} on Level 6) is never seen while drawing the boundary.`,
  "Error is the share of points misclassified, with both kinds of mistake costing the same.",
  `Your boundary is a chain of straight segments from the left edge to the right edge, with up to ${MAX_BENDS} bends. Above it you predict a failure, below it a healthy machine, so it can't be vertical or loop back.`,
  "A wigglier boundary is a more complex model. Training error falls as complexity grows, but test error usually rises again after a point (overfitting).",
  `The benchmark is a fitted model: logistic regression, drawn as a straight line or a gentle curve, whichever does better in ${CV_FOLDS}-fold cross-validation on the training data. The memorizer copies the label of the nearest training machine.`,
  `On Level 6 the model is k-nearest neighbors: a machine gets the majority label of its k closest training machines (k from ${Math.max(...KS)} down to ${Math.min(...KS)}), with distance measured on the plot as drawn. ${LEVELS[5].nVal} extra labeled machines are held out as a validation set to choose k.`,
];

// ---------------------------------------------------------------- the hidden process

/** Draw the parameters of a level's true boundary. */
export function makeTruth(rng, kind) {
  if (kind === "line") return { kind, a: rng.uniform(0.72, 0.88), b: rng.uniform(0.35, 0.6) };
  // "valley": machines fail at lower temperatures in a middle band of vibration (a resonance).
  return { kind: "valley", m: rng.uniform(0.45, 0.55), base: rng.uniform(0.2, 0.28), depth: rng.uniform(0.4, 0.5) };
}

/** Height of the true boundary at x: a machine truly fails when y is above it. */
export function truthY(truth, x) {
  if (truth.kind === "line") return truth.a - truth.b * x;
  return truth.base + truth.depth * ((x - truth.m) / 0.5) ** 2;
}

export function truthLabel(truth, p) {
  return p.y > truthY(truth, p.x) ? 1 : 0;
}

/**
 * Draw n labeled machines. Each is uniform over the plot; its label follows
 * the true rule and is then flipped with probability `noise`. With a margin,
 * machines closer than that to the true boundary are redrawn.
 */
export function samplePoints(rng, truth, n, noise = 0, margin = 0) {
  const pts = [];
  while (pts.length < n) {
    const p = { x: rng.uniform(0.02, 0.98), y: rng.uniform(0.02, 0.98) };
    if (margin > 0 && Math.abs(p.y - truthY(truth, p.x)) < margin) continue;
    const clean = truthLabel(truth, p);
    const flipped = rng.chance(noise);
    pts.push({ ...p, label: flipped ? 1 - clean : clean, flipped });
  }
  return pts;
}

/** One round: the true rule, the training set, the hidden test set, and (Level 6) a validation set. */
export function generateRound(rng, level) {
  const truth = makeTruth(rng, level.truth);
  const train = samplePoints(rng.fork("train"), truth, level.nTrain, level.noise, level.margin);
  const testSize = level.mode === "slider" ? SLIDER_TEST_SIZE : TEST_SIZE;
  const test = samplePoints(rng.fork("test"), truth, testSize, level.noise, level.margin);
  const round = { truth, train, test, noise: level.noise };
  if (level.nVal) round.val = samplePoints(rng.fork("validation"), truth, level.nVal, level.noise, level.margin);
  return round;
}

// ---------------------------------------------------------------- errors

/** Share of points a predictor gets wrong. predict(point) returns 0 or 1. */
export function errorOf(points, predict) {
  let wrong = 0;
  for (const p of points) if (predict(p) !== p.label) wrong += 1;
  return { wrong, n: points.length, rate: points.length ? wrong / points.length : 0 };
}

// ---------------------------------------------------------------- the player's boundary

/** A straight starting boundary: two anchors on the left and right edges. */
export function straightBoundary(yLeft = 0.5, yRight = 0.5) {
  return [
    { x: 0, y: yLeft },
    { x: 1, y: yRight },
  ];
}

/** Height of a piecewise-linear boundary at x. Control points must be sorted by x, from x = 0 to x = 1. */
export function boundaryY(ctrl, x) {
  if (x <= ctrl[0].x) return ctrl[0].y;
  for (let i = 1; i < ctrl.length; i++) {
    if (x <= ctrl[i].x) {
      const a = ctrl[i - 1];
      const b = ctrl[i];
      const t = b.x === a.x ? 1 : (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return ctrl[ctrl.length - 1].y;
}

/** Predict 1 (fails) above the boundary, 0 (healthy) on or below it. */
export function boundaryPredictor(ctrl) {
  return (p) => (p.y > boundaryY(ctrl, p.x) ? 1 : 0);
}

/** Number of bends: the interior control points. */
export function bends(ctrl) {
  return Math.max(0, ctrl.length - 2);
}

/** Add a bend at (x, y), keeping the points sorted. Returns the new list and the new point's index. */
export function addBend(ctrl, x, y) {
  if (bends(ctrl) >= MAX_BENDS) return { ctrl, index: -1 };
  const gap = 0.015;
  const cx = Math.min(1 - gap, Math.max(gap, x));
  if (ctrl.some((c) => Math.abs(c.x - cx) < gap)) return { ctrl, index: -1 };
  const index = ctrl.findIndex((c) => c.x > cx);
  const next = [...ctrl.slice(0, index), { x: cx, y: Math.min(1, Math.max(0, y)) }, ...ctrl.slice(index)];
  return { ctrl: next, index };
}

/** Add a bend in the middle of the widest gap, on the current boundary. */
export function addBendInWidestGap(ctrl) {
  let best = 1;
  for (let i = 2; i < ctrl.length; i++) if (ctrl[i].x - ctrl[i - 1].x > ctrl[best].x - ctrl[best - 1].x + 1e-12) best = i;
  const x = (ctrl[best].x + ctrl[best - 1].x) / 2;
  return addBend(ctrl, x, boundaryY(ctrl, x));
}

/** Remove bend i. The two edge anchors can't be removed. */
export function removeBend(ctrl, i) {
  if (i <= 0 || i >= ctrl.length - 1) return ctrl;
  return ctrl.filter((_, k) => k !== i);
}

/**
 * Move control point i. Anchors only move up and down; a bend can't cross its
 * neighbors, so the boundary stays a function of x.
 */
export function moveControl(ctrl, i, x, y) {
  const gap = 0.015;
  const out = ctrl.map((c) => ({ ...c }));
  out[i].y = Math.min(1, Math.max(0, y));
  if (i > 0 && i < ctrl.length - 1) out[i].x = Math.min(ctrl[i + 1].x - gap, Math.max(ctrl[i - 1].x + gap, x));
  return out;
}

// ---------------------------------------------------------------- logistic regression

/** Features for a point: degree 1 = a straight boundary, degree 2 = a curved one. Centered so 0 is mid-plot. */
function features(p, degree) {
  const u = 2 * p.x - 1;
  const v = 2 * p.y - 1;
  return degree === 1 ? [1, u, v] : [1, u, v, u * u, u * v, v * v];
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
export function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = Math.abs(M[r][r]) < 1e-12 ? 0 : s / M[r][r];
  }
  return x;
}

/**
 * Logistic regression by Newton's method, with a small ridge penalty so the
 * weights stay finite when the classes separate perfectly.
 */
export function fitLogistic(points, degree = 1, ridge = 0.01) {
  const X = points.map((p) => features(p, degree));
  const d = X[0].length;
  let w = new Array(d).fill(0);
  for (let iter = 0; iter < 30; iter++) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((s, f, k) => s + f * w[k], 0);
      const mu = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const s = Math.max(mu * (1 - mu), 1e-6);
      for (let a = 0; a < d; a++) {
        g[a] += (mu - points[i].label) * X[i][a];
        for (let b = 0; b < d; b++) H[a][b] += s * X[i][a] * X[i][b];
      }
    }
    for (let a = 1; a < d; a++) {
      g[a] += ridge * w[a];
      H[a][a] += ridge;
    }
    H[0][0] += 1e-9;
    const step = solve(H, g);
    w = w.map((v, k) => v - step[k]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return { degree, w };
}

/** The fitted model's score: positive means "fails". */
export function logisticScore(model, p) {
  return features(p, model.degree).reduce((s, f, k) => s + f * model.w[k], 0);
}

export function logisticPredictor(model) {
  return (p) => (logisticScore(model, p) > 0 ? 1 : 0);
}

/** Misclassified points in k-fold cross-validation (point i goes to fold i mod k). */
export function cvErrors(points, degree, folds = CV_FOLDS) {
  let wrong = 0;
  for (let f = 0; f < folds; f++) {
    const fit = points.filter((_, i) => i % folds !== f);
    const held = points.filter((_, i) => i % folds === f);
    if (!held.length || new Set(fit.map((p) => p.label)).size < 2) {
      // Too little data to fit: predict the majority label of the fitting part.
      const ones = fit.filter((p) => p.label === 1).length;
      const guess = ones * 2 > fit.length ? 1 : 0;
      wrong += held.filter((p) => p.label !== guess).length;
      continue;
    }
    wrong += errorOf(held, logisticPredictor(fitLogistic(fit, degree))).wrong;
  }
  return wrong;
}

/**
 * The benchmark: fit a straight and a curved logistic model, keep the curved
 * one only if it makes fewer cross-validation mistakes, then refit on all the
 * training data. The test set is never used.
 */
export function fitBenchmark(train) {
  const cv = { 1: cvErrors(train, 1), 2: cvErrors(train, 2) };
  const degree = cv[2] < cv[1] ? 2 : 1;
  return { ...fitLogistic(train, degree), cv };
}

// ---------------------------------------------------------------- nearest neighbors

/** Indices of the training points, nearest first, for a query point. */
function neighborOrder(train, p) {
  return train
    .map((t, i) => ({ i, d: (t.x - p.x) ** 2 + (t.y - p.y) ** 2 }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((o) => o.i);
}

/** k-nearest-neighbor prediction: the majority label of the k closest training points (ties go to "healthy"). */
export function knnPredict(train, p, k) {
  const order = neighborOrder(train, p);
  const kk = Math.min(k, train.length);
  let ones = 0;
  for (let j = 0; j < kk; j++) ones += train[order[j]].label;
  return ones * 2 > kk ? 1 : 0;
}

export function knnPredictor(train, k) {
  return (p) => knnPredict(train, p, k);
}

/** Predictions for many points and many values of k at once: result[k][pointIndex]. */
export function knnPredictAll(train, points, ks = KS) {
  const out = Object.fromEntries(ks.map((k) => [k, new Array(points.length)]));
  points.forEach((p, pi) => {
    const order = neighborOrder(train, p);
    let ones = 0;
    let j = 0;
    for (const k of [...ks].sort((a, b) => a - b)) {
      const kk = Math.min(k, train.length);
      for (; j < kk; j++) ones += train[order[j]].label;
      out[k][pi] = ones * 2 > kk ? 1 : 0;
    }
  });
  return out;
}

/** Training, validation, and test error for every k, in the order of KS (simple to complex). */
export function knnCurve(round, ks = KS) {
  const sets = { train: round.train, val: round.val, test: round.test };
  const preds = Object.fromEntries(Object.entries(sets).map(([name, pts]) => [name, knnPredictAll(round.train, pts, ks)]));
  const rate = (name, k) => sets[name].filter((p, i) => preds[name][k][i] !== p.label).length / sets[name].length;
  return ks.map((k) => ({ k, train: rate("train", k), val: rate("val", k), test: rate("test", k) }));
}

/** Index of the lowest value of curve[i][key]; ties go to the simpler model (earlier in the list). */
export function bestIndex(curve, key) {
  let best = 0;
  curve.forEach((c, i) => {
    if (c[key] < curve[best][key] - 1e-12) best = i;
  });
  return best;
}

// ---------------------------------------------------------------- scoring

/** Stars from how far the player's test error is above the benchmark's. */
export function starsFor(playerTest, benchmarkTest) {
  const gap = playerTest - benchmarkTest;
  if (gap <= STAR_GAPS[0] + 1e-9) return 3;
  if (gap <= STAR_GAPS[1] + 1e-9) return 2;
  if (gap <= STAR_GAPS[2] + 1e-9) return 1;
  return 0;
}

/** Everything the results screen needs for a hand-drawn boundary. */
export function evaluateBoundary(ctrl, train, test) {
  const predict = boundaryPredictor(ctrl);
  return { bends: bends(ctrl), train: errorOf(train, predict), test: errorOf(test, predict) };
}

/** The reference models for a training set, scored on train and test. */
export function referenceModels(train, test, truth) {
  const model = fitBenchmark(train);
  const fitted = logisticPredictor(model);
  const memorizer = knnPredictor(train, 1);
  const rule = (p) => truthLabel(truth, p);
  return {
    model,
    fitted: { train: errorOf(train, fitted), test: errorOf(test, fitted) },
    memorizer: { train: errorOf(train, memorizer), test: errorOf(test, memorizer) },
    truth: { train: errorOf(train, rule), test: errorOf(test, rule) },
  };
}
