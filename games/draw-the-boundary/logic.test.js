import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import { validateGameConfig } from "../shared/config.js";
import {
  ASSUMPTIONS,
  AXES,
  LEVELS,
  KS,
  TEST_SIZE,
  SLIDER_TEST_SIZE,
  MAX_BENDS,
  CV_FOLDS,
  STAR_GAPS,
  makeTruth,
  truthY,
  truthLabel,
  samplePoints,
  generateRound,
  errorOf,
  straightBoundary,
  boundaryY,
  boundaryPredictor,
  bends,
  addBend,
  addBendInWidestGap,
  removeBend,
  moveControl,
  solve,
  fitLogistic,
  logisticScore,
  logisticPredictor,
  cvErrors,
  fitBenchmark,
  knnPredict,
  knnPredictor,
  knnPredictAll,
  knnCurve,
  bestIndex,
  starsFor,
  evaluateBoundary,
  referenceModels,
} from "./logic.js";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} is not within ${tol} of ${b}`);
const level = (id) => LEVELS.find((l) => l.id === id);
const roundFor = (id, seed) => generateRound(createRng(`draw-the-boundary:${id}:${seed}`), level(id));
const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

test("rounds are reproducible from the seed", () => {
  for (const l of LEVELS) {
    assert.deepEqual(roundFor(l.id, 5), roundFor(l.id, 5));
    assert.notDeepEqual(roundFor(l.id, 5).train, roundFor(l.id, 6).train);
  }
});

test("set sizes match the level, and every point is on the plot with a 0/1 label", () => {
  for (const l of LEVELS) {
    const r = roundFor(l.id, 3);
    assert.equal(r.train.length, l.nTrain);
    assert.equal(r.test.length, l.mode === "slider" ? SLIDER_TEST_SIZE : TEST_SIZE);
    assert.equal(r.val ? r.val.length : 0, l.nVal || 0);
    for (const p of [...r.train, ...r.test, ...(r.val || [])]) {
      assert.ok(p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1);
      assert.ok(p.label === 0 || p.label === 1);
    }
  }
});

test("training, test, and validation sets are separate draws from the same process", () => {
  const r = roundFor("6", 9);
  const key = (p) => `${p.x},${p.y}`;
  const seen = new Set(r.train.map(key));
  assert.ok(r.test.every((p) => !seen.has(key(p))));
  assert.ok(r.val.every((p) => !seen.has(key(p))));
  // Same process: about the same share of failures in both sets.
  const shares = SEEDS.map((s) => roundFor("2", s)).map((x) => [avg(x.train.map((p) => p.label)), avg(x.test.map((p) => p.label))]);
  assert.ok(Math.abs(avg(shares.map((s) => s[0])) - avg(shares.map((s) => s[1]))) < 0.04);
});

test("labels follow the true rule except for the stated share of flips", () => {
  for (const l of LEVELS) {
    let flips = 0;
    let total = 0;
    for (const seed of SEEDS) {
      const r = roundFor(l.id, seed);
      for (const p of [...r.train, ...r.test]) {
        assert.equal(p.label, p.flipped ? 1 - truthLabel(r.truth, p) : truthLabel(r.truth, p));
        flips += p.flipped ? 1 : 0;
        total += 1;
      }
    }
    assert.ok(Math.abs(flips / total - l.noise) < 0.02, `level ${l.id}: flip share ${flips / total} vs noise ${l.noise}`);
  }
});

test("the true rule's test error is close to the noise level", () => {
  for (const l of LEVELS) {
    const rates = SEEDS.map((seed) => {
      const r = roundFor(l.id, seed);
      return errorOf(r.test, (p) => truthLabel(r.truth, p)).rate;
    });
    assert.ok(Math.abs(avg(rates) - l.noise) < 0.02);
  }
});

test("level 1 is cleanly separable by a straight line, with a margin", () => {
  for (const seed of SEEDS) {
    const r = roundFor("1", seed);
    assert.equal(r.truth.kind, "line");
    for (const p of [...r.train, ...r.test]) {
      assert.ok(!p.flipped);
      assert.ok(Math.abs(p.y - truthY(r.truth, p.x)) >= level("1").margin);
    }
    // The true line, drawn as a two-anchor boundary, makes no mistakes.
    const ctrl = straightBoundary(truthY(r.truth, 0), truthY(r.truth, 1));
    assert.equal(evaluateBoundary(ctrl, r.train, r.test).train.wrong, 0);
    assert.equal(evaluateBoundary(ctrl, r.train, r.test).test.wrong, 0);
  }
});

test("the true boundary stays inside the plot", () => {
  for (const kind of ["line", "valley"]) {
    for (const seed of SEEDS) {
      const t = makeTruth(createRng(seed), kind);
      for (let x = 0; x <= 1.0001; x += 0.05) {
        const y = truthY(t, x);
        assert.ok(y > 0.03 && y < 0.97, `${kind} seed ${seed}: y(${x}) = ${y}`);
      }
    }
  }
});

test("errorOf counts mistakes of both kinds equally", () => {
  const pts = [
    { x: 0.1, y: 0.1, label: 0 },
    { x: 0.2, y: 0.9, label: 1 },
    { x: 0.3, y: 0.9, label: 0 }, // false alarm
    { x: 0.4, y: 0.1, label: 1 }, // missed failure
  ];
  assert.deepEqual(errorOf(pts, (p) => (p.y > 0.5 ? 1 : 0)), { wrong: 2, n: 4, rate: 0.5 });
  assert.deepEqual(errorOf([], () => 1), { wrong: 0, n: 0, rate: 0 });
});

test("a hand-drawn boundary is piecewise linear and predicts 'fails' above it", () => {
  const ctrl = [
    { x: 0, y: 0.2 },
    { x: 0.5, y: 0.8 },
    { x: 1, y: 0.4 },
  ];
  near(boundaryY(ctrl, 0), 0.2);
  near(boundaryY(ctrl, 0.25), 0.5);
  near(boundaryY(ctrl, 0.5), 0.8);
  near(boundaryY(ctrl, 0.75), 0.6);
  near(boundaryY(ctrl, 1), 0.4);
  const predict = boundaryPredictor(ctrl);
  assert.equal(predict({ x: 0.25, y: 0.51 }), 1);
  assert.equal(predict({ x: 0.25, y: 0.49 }), 0);
  assert.equal(bends(ctrl), 1);
  assert.equal(bends(straightBoundary()), 0);
});

test("bends can be added, moved, and removed without breaking the boundary", () => {
  let ctrl = straightBoundary(0.5, 0.5);
  let res = addBend(ctrl, 0.3, 0.9);
  assert.equal(res.index, 1);
  ctrl = res.ctrl;
  res = addBend(ctrl, 0.1, 0.2);
  assert.equal(res.index, 1);
  ctrl = res.ctrl;
  assert.deepEqual(ctrl.map((c) => c.x), [0, 0.1, 0.3, 1]);
  // Too close to an existing point: refused.
  assert.equal(addBend(ctrl, 0.3001, 0.5).index, -1);
  // Widest gap is 0.3 to 1: the new bend goes to its middle, on the boundary.
  res = addBendInWidestGap(ctrl);
  near(res.ctrl[res.index].x, 0.65);
  near(res.ctrl[res.index].y, boundaryY(ctrl, 0.65));
  // A bend can't cross its neighbors; anchors keep their x.
  const moved = moveControl(ctrl, 1, 0.9, 2);
  assert.ok(moved[1].x < moved[2].x);
  assert.equal(moved[1].y, 1);
  assert.equal(moveControl(ctrl, 0, 0.5, 0.7)[0].x, 0);
  assert.equal(moveControl(ctrl, 0, 0.5, 0.7)[0].y, 0.7);
  assert.equal(moveControl(ctrl, 3, 0.5, -1)[3].x, 1);
  assert.equal(ctrl[1].y, 0.2, "moveControl must not change its input");
  // Anchors can't be removed.
  assert.equal(removeBend(ctrl, 0), ctrl);
  assert.equal(removeBend(ctrl, 3), ctrl);
  assert.deepEqual(removeBend(ctrl, 1).map((c) => c.x), [0, 0.3, 1]);
  // The number of bends is capped.
  let many = straightBoundary();
  for (let i = 0; i < 40; i++) many = addBendInWidestGap(many).ctrl;
  assert.equal(bends(many), MAX_BENDS);
  for (let i = 1; i < many.length; i++) assert.ok(many[i].x > many[i - 1].x);
});

test("a wiggly boundary can reach zero training error on noisy data, but does worse on the test set", () => {
  // Bend around every training point: the memorizing boundary.
  const gaps = [];
  for (const seed of SEEDS) {
    const r = roundFor("3", seed);
    const straight = straightBoundary(truthY(r.truth, 0), truthY(r.truth, 1));
    const honest = evaluateBoundary(straight, r.train, r.test);
    const memorizer = knnPredictor(r.train, 1);
    assert.equal(errorOf(r.train, memorizer).wrong, 0);
    gaps.push(errorOf(r.test, memorizer).rate - honest.test.rate);
    assert.ok(honest.train.rate > 0 || r.train.every((p) => !p.flipped));
  }
  assert.ok(avg(gaps) > 0.08, `memorizing should cost test error on average, got ${avg(gaps)}`);
});

test("solve handles a small linear system", () => {
  const x = solve(
    [
      [2, 1],
      [1, 3],
    ],
    [3, 5],
  );
  near(x[0], 0.8);
  near(x[1], 1.4);
});

test("logistic regression separates clean data and stays finite", () => {
  for (const seed of SEEDS) {
    const r = roundFor("1", seed);
    const model = fitLogistic(r.train, 1);
    assert.ok(model.w.every(Number.isFinite));
    assert.equal(errorOf(r.train, logisticPredictor(model)).wrong, 0, `seed ${seed}`);
    // Above the boundary scores higher: temperature pushes toward "fails".
    assert.ok(logisticScore(model, { x: 0.5, y: 0.95 }) > logisticScore(model, { x: 0.5, y: 0.05 }));
  }
});

test("the benchmark picks its shape by cross-validation on the training data only", () => {
  let curvedOnValley = 0;
  let curvedOnLine = 0;
  for (const seed of SEEDS) {
    const valley = roundFor("5", seed);
    const m = fitBenchmark(valley.train);
    assert.equal(m.degree, m.cv[2] < m.cv[1] ? 2 : 1);
    assert.equal(m.cv[1], cvErrors(valley.train, 1, CV_FOLDS));
    curvedOnValley += m.degree === 2 ? 1 : 0;
    curvedOnLine += fitBenchmark(roundFor("1", seed).train).degree === 2 ? 1 : 0;
    // Changing the test set can't change the fitted model.
    const other = { ...valley, test: roundFor("5", seed + 1000).test };
    assert.deepEqual(fitBenchmark(other.train).w, m.w);
  }
  assert.ok(curvedOnValley > SEEDS.length * 0.6, "with 120 points the curve should usually win on a curved truth");
  assert.ok(curvedOnLine < SEEDS.length * 0.25, "a straight line should usually be kept on a straight truth");
});

test("the benchmark is a reasonable classifier: not far above the noise floor", () => {
  for (const l of LEVELS.filter((x) => x.mode !== "slider")) {
    const gaps = SEEDS.map((seed) => {
      const r = roundFor(l.id, seed);
      const ref = referenceModels(r.train, r.test, r.truth);
      assert.equal(ref.memorizer.train.wrong, 0);
      return ref.fitted.test.rate - ref.truth.test.rate;
    });
    assert.ok(avg(gaps) < 0.12, `level ${l.id}: benchmark is ${avg(gaps)} above the true rule on average`);
  }
});

test("more training data helps the fitted model (level 5)", () => {
  const l = level("5");
  const small = [];
  const large = [];
  for (const seed of SEEDS) {
    const r = roundFor("5", seed);
    small.push(referenceModels(r.train.slice(0, l.nSmall), r.test, r.truth).fitted.test.rate);
    large.push(referenceModels(r.train, r.test, r.truth).fitted.test.rate);
  }
  assert.ok(avg(small) > avg(large) + 0.05);
});

test("k-nearest neighbors: majority vote of the closest training points", () => {
  const train = [
    { x: 0.1, y: 0.1, label: 0 },
    { x: 0.2, y: 0.1, label: 0 },
    { x: 0.15, y: 0.2, label: 1 },
    { x: 0.8, y: 0.8, label: 1 },
    { x: 0.9, y: 0.8, label: 1 },
  ];
  const q = { x: 0.15, y: 0.19 };
  assert.equal(knnPredict(train, q, 1), 1);
  assert.equal(knnPredict(train, q, 3), 0);
  assert.equal(knnPredict(train, q, 5), 1);
  assert.equal(knnPredict(train, q, 99), 1); // k larger than the training set uses all of it
  const all = knnPredictAll(train, [q, { x: 0.85, y: 0.8 }], [5, 3, 1]);
  assert.deepEqual(all, { 5: [1, 1], 3: [0, 1], 1: [1, 1] });
});

test("complexity curve: training error falls to 0 at k = 1, test error is U-shaped on average", () => {
  const curves = SEEDS.map((seed) => knnCurve(roundFor("6", seed)));
  assert.deepEqual(curves[0].map((c) => c.k), KS);
  for (const c of curves) assert.equal(c[c.length - 1].train, 0, "1-NN memorizes the training set");
  const meanAt = (i, key) => avg(curves.map((c) => c[i][key]));
  const test = KS.map((_, i) => meanAt(i, "test"));
  const train = KS.map((_, i) => meanAt(i, "train"));
  const low = Math.min(...test);
  const at = test.indexOf(low);
  assert.ok(at > 0 && at < KS.length - 1, "the best complexity is in the middle");
  assert.ok(test[0] > low + 0.05, "too simple: underfits");
  assert.ok(test[KS.length - 1] > low + 0.03, "too complex: overfits");
  for (let i = 1; i < KS.length; i++) assert.ok(train[i] < train[i - 1], "training error keeps falling with complexity");
  // Validation is a fair stand-in for the test set: its pick is close to the best in hindsight.
  const regret = avg(curves.map((c) => c[bestIndex(c, "val")].test - c[bestIndex(c, "test")].test));
  assert.ok(regret < 0.05);
});

test("KS runs from simple to complex with odd k, so votes can't tie", () => {
  for (let i = 1; i < KS.length; i++) assert.ok(KS[i] < KS[i - 1]);
  assert.ok(KS.every((k) => k % 2 === 1));
  assert.equal(KS[KS.length - 1], 1);
  assert.ok(KS[0] <= level("6").nTrain);
});

test("bestIndex breaks ties toward the simpler model", () => {
  const curve = [{ val: 0.3 }, { val: 0.2 }, { val: 0.2 }, { val: 0.25 }];
  assert.equal(bestIndex(curve, "val"), 1);
});

test("stars compare the player's test error with the benchmark's", () => {
  assert.equal(starsFor(0.1, 0.12), 3);
  assert.equal(starsFor(0.12 + STAR_GAPS[0], 0.12), 3);
  assert.equal(starsFor(0.16, 0.12), 2);
  assert.equal(starsFor(0.21, 0.12), 1);
  assert.equal(starsFor(0.3, 0.12), 0);
});

test("levels are well formed", () => {
  const cfg = { slug: "draw-the-boundary", title: "t", tagline: "t", objective: "o", howToPlay: ["x"], assumptions: ASSUMPTIONS, levels: LEVELS, start() {} };
  assert.deepEqual(validateGameConfig(cfg), []);
  assert.ok(level("5").nSmall < level("5").nTrain);
  assert.deepEqual(LEVELS.map((l) => l.mode), ["draw", "draw", "draw", "draw", "two", "slider"]);
});

test("the assumptions shown to students match the model", () => {
  const text = ASSUMPTIONS.join(" ");
  assert.ok(text.includes(AXES.x.label.toLowerCase()) && text.includes(AXES.y.label.toLowerCase()));
  assert.ok(text.includes(`${TEST_SIZE} machines`));
  assert.ok(text.includes(`${SLIDER_TEST_SIZE} on Level 6`));
  assert.equal(level("6").mode, "slider");
  assert.ok(text.includes(`up to ${MAX_BENDS} bends`));
  assert.ok(text.includes(`${CV_FOLDS}-fold cross-validation`));
  assert.ok(text.includes(`k from ${KS[0]} down to ${KS[KS.length - 1]}`));
  assert.ok(text.includes(`${level("6").nVal} extra labeled machines`));
  const noises = LEVELS.map((l) => Math.round(l.noise * 100));
  assert.ok(text.includes(`${Math.min(...noises)}% to ${Math.max(...noises)}%`));
  assert.match(text, /both kinds of mistake costing the same/);
  assert.match(text, /never seen while drawing/);
  assert.match(text, /overfitting/);
});
