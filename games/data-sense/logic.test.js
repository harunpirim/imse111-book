import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../shared/rng.js";
import { validateGameConfig } from "../shared/config.js";
import {
  ASSUMPTIONS,
  LEVELS,
  STORIES,
  SERIES,
  CLOSE,
  ZERO_POINTS_AT,
  GUESS_STEP,
  IQR_K,
  Z_LIMIT,
  CURVE_R_MAX,
  MAX_OUTLIERS,
  mean,
  sd,
  median,
  quantile,
  pearson,
  leastSquares,
  fences,
  iqrOutliers,
  zScores,
  zOutliers,
  fenceBoxOutliers,
  summaryWithout,
  describeR,
  curveY,
  generateRound,
  snapGuess,
  guessPoints,
  isClose,
  guessSummary,
  starsForGuess,
  scorePicks,
  starsForPicks,
} from "./logic.js";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} is not within ${tol} of ${b}`);
const level = (id) => LEVELS.find((l) => l.id === id);
const roundFor = (id, seed) => generateRound(createRng(`data-sense:${id}:${seed}`), level(id));
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

test("mean, sample standard deviation, and median", () => {
  const a = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(mean(a), 5);
  near(sd(a), Math.sqrt(32 / 7));
  assert.equal(median(a), 4.5);
  assert.equal(median([3, 1, 2]), 2);
});

test("quartiles use linear interpolation, like numpy and QUARTILE.INC", () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  near(quantile(a, 0.25), 3.25);
  near(quantile(a, 0.75), 7.75);
  near(quantile([7, 15, 36, 39, 40, 41], 0.25), 20.25); // numpy.percentile(..., 25)
  assert.equal(quantile([5], 0.25), 5);
});

test("Pearson's r on known data", () => {
  near(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  near(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  near(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]), 0.8);
  assert.equal(pearson([1, 2, 3], [5, 5, 5]), 0); // no variation in y
});

test("r is 0 for a perfect U: it only measures straight-line association", () => {
  const xs = [-3, -2, -1, 0, 1, 2, 3];
  near(pearson(xs, xs.map((x) => x * x)), 0);
});

test("least-squares line", () => {
  const { slope, intercept } = leastSquares([0, 1, 2, 3], [1, 3, 5, 7]);
  near(slope, 2);
  near(intercept, 1);
});

test("the 1.5 x IQR rule", () => {
  const a = [10, 12, 12, 13, 12, 11, 14, 13, 15, 10, 100];
  const f = fences(a);
  near(f.q1, 11.5);
  near(f.q3, 13.5);
  near(f.iqr, 2);
  near(f.lo, 11.5 - IQR_K * 2);
  near(f.hi, 13.5 + IQR_K * 2);
  assert.deepEqual(iqrOutliers(a), [10]);
  assert.deepEqual(iqrOutliers([1, 2, 3, 4, 5]), []);
  // A value exactly on the fence is not beyond it.
  assert.deepEqual(iqrOutliers([0, 4, 4, 4, 4, 4, 4, 4, 4, 4, 8, 4]), [0, 10]);
  assert.deepEqual(iqrOutliers([1, 2, 3, 4, 5, 5 + 0]), []);
});

test("the 3-sigma rule, and how a small sample hides its own outlier", () => {
  const z = zScores([1, 2, 3]);
  near(z[0], -1);
  near(z[2], 1);
  // 10 values: the largest possible |z| is (n - 1) / sqrt(n) = 2.85, so nothing can be flagged.
  const small = [5, 5, 5, 5, 5, 5, 5, 5, 5, 500];
  assert.deepEqual(zOutliers(small), []);
  assert.deepEqual(iqrOutliers(small), [9]);
  const big = [...Array(29).fill(0).map((_, i) => 10 + (i % 3)), 60];
  assert.deepEqual(zOutliers(big), [29]);
  assert.equal(Z_LIMIT, 3);
});

test("the scatter rule flags a point that is beyond a fence on either axis", () => {
  const pts = [1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({ x: v, y: v }));
  assert.deepEqual(fenceBoxOutliers(pts), []);
  assert.deepEqual(fenceBoxOutliers([...pts, { x: 4, y: 40 }]), [8]);
  assert.deepEqual(fenceBoxOutliers([...pts, { x: 40, y: 4 }]), [8]);
});

test("summaryWithout compares all values with the kept ones", () => {
  const s = summaryWithout([10, 11, 12, 13, 54], [4]);
  assert.equal(s.all.mean, 20);
  assert.equal(s.kept.mean, 11.5);
  assert.equal(s.all.median, 12);
  assert.equal(s.kept.median, 11.5);
  assert.ok(s.all.sd > s.kept.sd);
});

test("describeR names size and direction", () => {
  assert.equal(describeR(0.05), "no straight-line relationship");
  assert.equal(describeR(-0.2), "weak negative");
  assert.equal(describeR(0.5), "moderate positive");
  assert.equal(describeR(-0.7), "fairly strong negative");
  assert.equal(describeR(0.93), "strong positive");
});

test("rounds are reproducible from the seed", () => {
  for (const l of LEVELS) {
    assert.deepEqual(roundFor(l.id, 77), roundFor(l.id, 77));
    assert.notDeepEqual(roundFor(l.id, 77), roundFor(l.id, 78));
  }
});

test("every round has the planned number of datasets and no repeated story", () => {
  for (const l of LEVELS) {
    for (const seed of SEEDS) {
      const round = roundFor(l.id, seed);
      assert.equal(round.mode, l.mode);
      assert.equal(round.items.length, l.take || l.plan.length);
      const ids = round.items.map((it) => (it.story || it.series).id);
      assert.equal(new Set(ids).size, ids.length, `level ${l.id} seed ${seed} repeats a story`);
    }
  }
});

test("scatter values stay on their axis, and r is computed from the plotted values", () => {
  for (const id of ["1", "2", "3", "6"]) {
    for (const seed of SEEDS) {
      for (const it of roundFor(id, seed).items) {
        for (const p of it.points) {
          assert.ok(p.x >= it.story.x.min && p.x <= it.story.x.max);
          assert.ok(p.y >= it.story.y.min && p.y <= it.story.y.max);
          assert.equal(p.x, Number(p.x.toFixed(it.story.x.dp)));
        }
        near(it.r, pearson(it.points.map((p) => p.x), it.points.map((p) => p.y)));
        assert.ok(it.r >= -1 && it.r <= 1);
      }
    }
  }
});

test("honest plots follow the story's direction", () => {
  for (const seed of SEEDS) {
    for (const it of roundFor("1", seed).items) {
      if (it.kind === "strong") {
        assert.equal(Math.sign(it.r), it.sign);
        assert.ok(Math.abs(it.r) > 0.6);
        assert.ok(STORIES[it.sign > 0 ? "pos" : "neg"].includes(it.story));
      }
    }
  }
});

test("trap: a strong curve gives r near 0", () => {
  for (const seed of SEEDS) {
    const it = roundFor("3", seed).items.find((x) => x.kind === "curve");
    assert.ok(Math.abs(it.r) <= CURVE_R_MAX, `seed ${seed}: r = ${it.r}`);
    // The pattern really is strong: the points sit close to the generating curve.
    const span = it.story.y.max - it.story.y.min;
    const off = mean(it.points.map((p) => Math.abs(p.y - curveY(it.story, p.x)))) / span;
    assert.ok(off < 0.08, `seed ${seed}: mean distance from the curve ${off}`);
  }
});

test("trap: one planted point creates or destroys the correlation", () => {
  let made = 0;
  let broke = 0;
  for (const seed of SEEDS) {
    const items = roundFor("3", seed).items;
    const makes = items.find((x) => x.kind === "makes");
    const breaks = items.find((x) => x.kind === "breaks");
    const rest = (it) => it.points.filter((_, i) => i !== it.planted);
    near(makes.rWithout, pearson(rest(makes).map((p) => p.x), rest(makes).map((p) => p.y)));
    assert.ok(Math.abs(breaks.rWithout) > 0.75);
    made += Math.abs(makes.r) - Math.abs(makes.rWithout);
    broke += Math.abs(breaks.rWithout) - Math.abs(breaks.r);
  }
  assert.ok(made / SEEDS.length > 0.3, "the planted corner point should raise |r| a lot on average");
  assert.ok(broke / SEEDS.length > 0.4, "the planted off-trend point should lower |r| a lot on average");
});

test("trap: a narrow slice of x hides a strong trend", () => {
  let gap = 0;
  for (const seed of SEEDS) {
    const it = roundFor("3", seed).items.find((x) => x.kind === "restricted");
    assert.equal(it.points.length, level("3").n);
    assert.ok(Math.abs(it.rFull) > 0.7);
    assert.ok(it.outside.length >= 2 * it.points.length, "most of the population lies outside the slice");
    const [lo, hi] = it.window;
    assert.ok(it.points.every((p) => p.x >= lo && p.x <= hi));
    gap += Math.abs(it.rFull) - Math.abs(it.r);
  }
  assert.ok(gap / SEEDS.length > 0.3);
});

test("outlier levels: the answer is exactly what the rule says", () => {
  for (const seed of SEEDS) {
    for (const it of roundFor("4", seed).items) assert.deepEqual(it.outliers, iqrOutliers(it.values));
    for (const it of roundFor("5", seed).items) assert.deepEqual(it.outliers, zOutliers(it.values));
    for (const it of roundFor("6", seed).items) {
      assert.deepEqual(it.outliers, fenceBoxOutliers(it.points));
      const kept = it.points.filter((_, i) => !it.outliers.includes(i));
      near(it.rKept, pearson(kept.map((p) => p.x), kept.map((p) => p.y)));
      if (it.planted !== undefined) assert.ok(it.outliers.includes(it.planted), `seed ${seed}: planted point not flagged`);
    }
  }
});

test("outlier levels: answers are small, and sometimes there is nothing to find", () => {
  let empty = 0;
  for (const id of ["4", "5", "6"]) {
    for (const seed of SEEDS) {
      for (const it of roundFor(id, seed).items) {
        assert.ok(it.outliers.length <= MAX_OUTLIERS, `level ${id} seed ${seed}: ${it.outliers.length} outliers`);
        if (it.outliers.length === 0) empty += 1;
        if (it.values) assert.ok(it.values.every((v) => v >= 0));
      }
    }
  }
  assert.ok(empty > 20, "some datasets should have no outliers at all");
});

test("3-sigma level: big enough samples, and the rule is stricter than the box-plot rule", () => {
  let zCount = 0;
  let iqrCount = 0;
  for (const seed of SEEDS) {
    for (const it of roundFor("5", seed).items) {
      // With fewer than 11 values no point can reach |z| > 3.
      assert.ok(it.n >= 20);
      if (it.kind === "far") assert.equal(it.outliers.length >= 1, true);
      zCount += it.outliers.length;
      iqrCount += iqrOutliers(it.values).length;
    }
  }
  assert.ok(iqrCount > zCount * 2);
});

test("guess scoring", () => {
  assert.equal(guessPoints(0.6, 0.6), 100);
  assert.equal(guessPoints(0.5, 0.6), 80);
  assert.equal(guessPoints(0.6, 0.6 - ZERO_POINTS_AT), 0);
  assert.equal(guessPoints(-1, 1), 0);
  assert.ok(isClose(0.5, 0.5 + CLOSE));
  assert.ok(!isClose(0.5, 0.5 + CLOSE + 0.02));
  assert.equal(snapGuess(0.4999), 0.5);
  assert.equal(snapGuess(-0.33), -0.35);
  assert.equal(snapGuess(3), 1);
  assert.equal(snapGuess(0.15) % GUESS_STEP < 1e-9 || GUESS_STEP - (snapGuess(0.15) % GUESS_STEP) < 1e-9, true);
});

test("guess summary tracks the mean error, points, and longest streak", () => {
  const s = guessSummary([
    { guess: 0.5, r: 0.55 }, // close
    { guess: 0.0, r: 0.08 }, // close
    { guess: 0.9, r: 0.4 }, // miss, error 0.5
    { guess: -0.6, r: -0.62 }, // close
  ]);
  assert.equal(s.count, 4);
  assert.equal(s.close, 3);
  assert.equal(s.longestStreak, 2);
  assert.equal(s.streak, 1);
  near(s.meanError, (0.05 + 0.08 + 0.5 + 0.02) / 4);
  assert.equal(s.points, 90 + 84 + 0 + 96);
  assert.equal(guessSummary([]).meanError, 0);
});

test("stars for guessing", () => {
  assert.equal(starsForGuess(0.05), 3);
  assert.equal(starsForGuess(CLOSE), 3);
  assert.equal(starsForGuess(0.15), 2);
  assert.equal(starsForGuess(0.3), 1);
  assert.equal(starsForGuess(0.5), 0);
});

test("pick scoring: exact matches, misses, and extra picks", () => {
  assert.deepEqual(scorePicks([3, 7], [7, 3]), { hits: 2, extra: 0, missed: 0, exact: true, score: 1 });
  assert.deepEqual(scorePicks([], []), { hits: 0, extra: 0, missed: 0, exact: true, score: 1 });
  assert.deepEqual(scorePicks([1], []), { hits: 0, extra: 1, missed: 0, exact: false, score: 0 });
  assert.deepEqual(scorePicks([], [4]), { hits: 0, extra: 0, missed: 1, exact: false, score: 0 });
  assert.deepEqual(scorePicks([4, 5], [4, 6]), { hits: 1, extra: 1, missed: 1, exact: false, score: 1 / 3 });
  assert.equal(starsForPicks(1), 3);
  assert.equal(starsForPicks(0.875), 2);
  assert.equal(starsForPicks(0.5), 1);
  assert.equal(starsForPicks(0.2), 0);
});

test("levels and stories are well formed", () => {
  const cfg = { slug: "data-sense", title: "t", tagline: "t", objective: "o", howToPlay: ["x"], assumptions: ASSUMPTIONS, levels: LEVELS, start() {} };
  assert.deepEqual(validateGameConfig(cfg), []);
  for (const list of Object.values(STORIES)) {
    for (const s of list) {
      assert.ok(s.x.max > s.x.min && s.y.max > s.y.min);
      assert.ok(s.things && s.x.label && s.y.label);
    }
  }
  // Enough stories for the largest plan of each kind.
  assert.ok(STORIES.pos.length + STORIES.neg.length >= 4);
  assert.ok(SERIES.filter((s) => !s.skew).length >= 4);
  assert.ok(SERIES.some((s) => s.skew));
});

test("the assumptions shown to students match the model", () => {
  const text = ASSUMPTIONS.join(" ");
  assert.ok(ASSUMPTIONS.length >= 5);
  assert.ok(text.includes(`${IQR_K} × IQR`));
  assert.ok(text.includes(`${Z_LIMIT} standard deviations`));
  assert.ok(text.includes(`within ${CLOSE.toFixed(2)}`));
  assert.ok(text.includes(`${ZERO_POINTS_AT.toFixed(2)} or more away`));
  // The levels named in the text use the rules the text says they use.
  assert.match(text, /Levels 4 and 6/);
  assert.equal(level("4").rule, "iqr");
  assert.equal(level("6").rule, "box");
  assert.match(text, /\(Level 5\)/);
  assert.equal(level("5").rule, "z");
  assert.match(text, /from −1 to \+1/);
  assert.match(text, /doesn't imply causation/);
  assert.match(text, /linear interpolation/);
  assert.match(text, /n − 1/);
});
