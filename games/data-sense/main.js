// Data Sense: two modes in one game. Guess r asks for Pearson's r from a
// scatter plot; Find the Outlier asks which points a fixed rule would flag.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt } from "../shared/dom.js";
import {
  ASSUMPTIONS,
  LEVELS,
  CLOSE,
  GUESS_STEP,
  IQR_K,
  Z_LIMIT,
  mean,
  sd,
  median,
  leastSquares,
  fences,
  iqrOutliers,
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

const MINUS = "−";
/** A number with a real minus sign. */
const num = (v, dp = 0) => fmt(v, dp).replace("-", MINUS);
/** r with an explicit sign: +0.62, −0.35, 0.00. */
const fmtR = (r) => {
  const s = fmt(Math.abs(r), 2);
  return Number(s) === 0 ? s : (r > 0 ? "+" : MINUS) + s;
};
const axisTitle = (a) => (a.unit ? `${a.label} (${a.unit})` : a.label);
const withUnit = (a, v) => `${num(v, a.dp)}${a.unit ? ` ${a.unit}` : ""}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const pairTitle = (story) => `${story.x.label} vs. ${lower(story.y.label)}`;

// ---------------------------------------------------------------- drawing helpers

/** Chart width that keeps SVG text near its CSS size: the container's width, clamped. */
function chartWidth(el, max = 620) {
  const w = el && el.clientWidth ? el.clientWidth : max;
  return Math.round(Math.min(max, Math.max(260, w)));
}

/** Round tick positions that cover [min, max]. */
function niceTicks(min, max, target = 5) {
  const span = max - min || 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const dp = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(dp + 2)));
  return { ticks, dp };
}

function paddedDomain(values, pad = 0.07) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) || 1;
  return [lo - span * pad, hi + span * pad];
}

const diamond = (cx, cy, r) => `M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} z`;

/**
 * One data point. While picking it is a focusable checkbox with a big touch
 * target; after the reveal it is a plain mark (diamond = flagged by the rule,
 * square ring = picked by the player), so shape carries the meaning, not color.
 */
function pointMark(cx, cy, r, o) {
  const ring = svg("rect", { x: cx - r - 4, y: cy - r - 4, width: 2 * r + 8, height: 2 * r + 8, rx: 2, class: "ds-ring" });
  if (o.pickable) {
    return svg(
      "g",
      { class: "ds-pick", role: "checkbox", "aria-checked": String(o.picked), "aria-label": o.label, tabindex: "-1", dataset: { i: o.index } },
      svg("circle", { cx, cy, r: Math.max(13, r + 7), class: "ds-hit" }),
      ring,
      svg("circle", { cx, cy, r, class: "ds-dot" }),
    );
  }
  return svg(
    "g",
    { class: `ds-mark${o.flagged ? " is-flagged" : ""}${o.picked ? " is-picked" : ""}${o.ghost ? " is-ghost" : ""}` },
    o.picked ? ring : null,
    o.flagged ? svg("path", { d: diamond(cx, cy, r + 2.5), class: "ds-dot" }) : svg("circle", { cx, cy, r, class: "ds-dot" }),
    o.circled ? svg("circle", { cx, cy, r: r + 7, class: "ds-circled" }) : null,
  );
}

/**
 * Make the .ds-pick marks inside `root` behave as one keyboard stop: arrow
 * keys move between points (in the given order), Space or Enter toggles.
 */
function wirePicking(root, order, selected, onChange) {
  const marks = new Map([...root.querySelectorAll(".ds-pick")].map((el) => [Number(el.dataset.i), el]));
  if (!marks.size) return;
  let current = order[0];
  marks.get(current).setAttribute("tabindex", "0");
  const toggle = (i) => {
    if (selected.has(i)) selected.delete(i);
    else selected.add(i);
    marks.get(i).setAttribute("aria-checked", String(selected.has(i)));
    onChange(i);
  };
  const focus = (i) => {
    marks.get(current).setAttribute("tabindex", "-1");
    current = i;
    marks.get(i).setAttribute("tabindex", "0");
    marks.get(i).focus();
  };
  marks.forEach((el, i) => {
    el.addEventListener("click", () => {
      focus(i);
      toggle(i);
    });
    el.addEventListener("keydown", (e) => {
      const pos = order.indexOf(i);
      const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (step) {
        e.preventDefault();
        focus(order[(pos + step + order.length) % order.length]);
      } else if (e.key === "Home") {
        e.preventDefault();
        focus(order[0]);
      } else if (e.key === "End") {
        e.preventDefault();
        focus(order[order.length - 1]);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggle(i);
      }
    });
  });
}

let clipCount = 0;

/**
 * Scatter plot.
 * o.story     axis labels and units
 * o.ghost     extra hollow points (the part of the population that wasn't sampled)
 * o.lines     [{ slope, intercept, cls }] straight lines across the plot
 * o.curve     function x -> y, drawn dashed
 * o.band      [lo, hi] shaded range of x
 * o.box       { x: fences, y: fences } dashed fence box
 * o.circled   index of one point to circle
 * o.pick      { selected: Set } makes the points pickable
 * o.flagged / o.picked   index lists shown after the reveal
 */
function scatterPlot(points, o) {
  const W = o.width;
  const H = Math.round(Math.min(380, Math.max(230, W * 0.62)));
  const m = { l: 48, r: 12, t: 12, b: 44 };
  const all = [...points, ...(o.ghost || [])];
  const xv = all.map((p) => p.x);
  const yv = all.map((p) => p.y);
  if (o.box) {
    xv.push(o.box.x.lo, o.box.x.hi);
    yv.push(o.box.y.lo, o.box.y.hi);
  }
  const [x0, x1] = paddedDomain(xv);
  const [y0, y1] = paddedDomain(yv);
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const els = [];
  const clip = `ds-clip-${++clipCount}`;
  els.push(svg("defs", {}, svg("clipPath", { id: clip }, svg("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }))));
  els.push(svg("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: "ds-frame" }));

  const xt = niceTicks(x0, x1, W < 400 ? 4 : 6);
  const yt = niceTicks(y0, y1, 5);
  xt.ticks.forEach((v) => {
    els.push(svg("line", { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, class: "ds-grid" }));
    els.push(svg("text", { x: X(v), y: H - m.b + 15, class: "ds-tick", "text-anchor": "middle" }, num(v, xt.dp)));
  });
  yt.ticks.forEach((v) => {
    els.push(svg("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "ds-grid" }));
    els.push(svg("text", { x: m.l - 6, y: Y(v) + 4, class: "ds-tick", "text-anchor": "end" }, num(v, yt.dp)));
  });
  els.push(svg("text", { x: (m.l + W - m.r) / 2, y: H - 8, class: "ds-axis-title", "text-anchor": "middle" }, axisTitle(o.story.x)));
  els.push(svg("text", { x: 13, y: (m.t + H - m.b) / 2, class: "ds-axis-title", "text-anchor": "middle", transform: `rotate(-90 13 ${(m.t + H - m.b) / 2})` }, axisTitle(o.story.y)));

  const clipped = svg("g", { "clip-path": `url(#${clip})` });
  if (o.band) clipped.append(svg("rect", { x: X(o.band[0]), width: X(o.band[1]) - X(o.band[0]), y: m.t, height: H - m.t - m.b, class: "ds-band" }));
  if (o.box) {
    const b = o.box;
    clipped.append(svg("rect", { x: X(b.x.lo), y: Y(b.y.hi), width: X(b.x.hi) - X(b.x.lo), height: Y(b.y.lo) - Y(b.y.hi), class: "ds-fencebox" }));
  }
  if (o.curve) {
    const d = Array.from({ length: 61 }, (_, k) => {
      const v = x0 + ((x1 - x0) * k) / 60;
      return `${k ? "L" : "M"}${X(v).toFixed(1)},${Y(o.curve(v)).toFixed(1)}`;
    }).join("");
    clipped.append(svg("path", { d, class: "ds-curve" }));
  }
  (o.lines || []).forEach((ln) => {
    clipped.append(svg("line", { x1: X(x0), x2: X(x1), y1: Y(ln.intercept + ln.slope * x0), y2: Y(ln.intercept + ln.slope * x1), class: `ds-fit ${ln.cls || ""}` }));
  });
  els.push(clipped);

  const r = W < 400 ? 4 : 4.5;
  (o.ghost || []).forEach((p) => els.push(pointMark(X(p.x), Y(p.y), r - 0.5, { ghost: true })));
  const flagged = new Set(o.flagged || []);
  const picked = new Set(o.picked || []);
  points.forEach((p, i) => {
    els.push(
      pointMark(X(p.x), Y(p.y), r, {
        index: i,
        pickable: !!o.pick,
        picked: o.pick ? o.pick.selected.has(i) : picked.has(i),
        flagged: flagged.has(i),
        circled: o.circled === i,
        label: `Point ${i + 1} of ${points.length}: ${withUnit(o.story.x, p.x)}, ${withUnit(o.story.y, p.y)}`,
      }),
    );
  });
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "ds-svg", role: o.pick ? "group" : "img", "aria-label": o.label }, els);
}

/**
 * Dot plot of one variable, with ties stacked.
 * o.series    label, unit, dp
 * o.pick      { selected: Set } makes the dots pickable
 * o.rule      "iqr" | "z": after the reveal, draw the box plot and fences, or the mean and 3-sigma limits
 * o.flagged / o.picked   index lists shown after the reveal
 */
function dotPlot(values, o) {
  const W = o.width;
  const r = 6;
  const m = { l: 18, r: 18, b: 44 };
  const extra = [];
  let f = null;
  let zl = null;
  if (o.rule === "iqr") {
    f = fences(values);
    extra.push(f.lo, f.hi);
  } else if (o.rule === "z") {
    const mu = mean(values);
    const s = sd(values);
    zl = { mu, lo: mu - Z_LIMIT * s, hi: mu + Z_LIMIT * s };
    extra.push(zl.lo, zl.hi);
  }
  const [x0, x1] = paddedDomain([...values, ...extra], 0.06);
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);

  // Stack dots that would overlap.
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const lastX = [];
  const level = new Array(values.length).fill(0);
  order.forEach((i) => {
    const px = X(values[i]);
    let k = 0;
    while (lastX[k] !== undefined && px - lastX[k] < 2 * r + 1.5) k += 1;
    lastX[k] = px;
    level[i] = k;
  });
  const stackH = Math.max(4, lastX.length) * (2 * r + 2) + 10;
  const top = o.rule ? 62 : 12;
  const H = top + stackH + m.b;
  const base = top + stackH;
  const els = [];

  els.push(svg("line", { x1: m.l, x2: W - m.r, y1: base, y2: base, class: "ds-axis" }));
  const t = niceTicks(x0, x1, W < 400 ? 4 : 7);
  const dp = Math.max(t.dp, 0);
  t.ticks.forEach((v) => {
    els.push(svg("line", { x1: X(v), x2: X(v), y1: base, y2: base + 5, class: "ds-axis" }));
    els.push(svg("text", { x: X(v), y: base + 18, class: "ds-tick", "text-anchor": "middle" }, num(v, dp)));
  });
  els.push(svg("text", { x: W / 2, y: H - 8, class: "ds-axis-title", "text-anchor": "middle" }, `${o.series.label} (${o.series.unit})`));

  const limitLine = (v, text) => {
    const px = X(v);
    els.push(svg("line", { x1: px, x2: px, y1: 18, y2: base, class: "ds-fence" }));
    els.push(svg("text", { x: px, y: 12, class: "ds-fence-label", "text-anchor": px < 70 ? "start" : px > W - 70 ? "end" : "middle" }, text));
  };
  if (f) {
    const flaggedSet = new Set(o.flagged || []);
    const inside = values.filter((_, i) => !flaggedSet.has(i));
    const by = 40;
    limitLine(f.lo, `fence ${num(f.lo, o.series.dp + 1)}`);
    limitLine(f.hi, `fence ${num(f.hi, o.series.dp + 1)}`);
    els.push(svg("line", { x1: X(Math.min(...inside)), x2: X(f.q1), y1: by, y2: by, class: "ds-whisker" }));
    els.push(svg("line", { x1: X(f.q3), x2: X(Math.max(...inside)), y1: by, y2: by, class: "ds-whisker" }));
    els.push(svg("rect", { x: X(f.q1), y: by - 11, width: Math.max(1, X(f.q3) - X(f.q1)), height: 22, class: "ds-box" }));
    const mid = median(values);
    els.push(svg("line", { x1: X(mid), x2: X(mid), y1: by - 11, y2: by + 11, class: "ds-median" }));
  }
  if (zl) {
    limitLine(zl.lo, `−${Z_LIMIT} SD ${num(zl.lo, o.series.dp + 1)}`);
    limitLine(zl.hi, `+${Z_LIMIT} SD ${num(zl.hi, o.series.dp + 1)}`);
    els.push(svg("line", { x1: X(zl.mu), x2: X(zl.mu), y1: 30, y2: base, class: "ds-meanline" }));
    els.push(svg("text", { x: X(zl.mu), y: 26, class: "ds-fence-label", "text-anchor": "middle" }, `mean ${num(zl.mu, o.series.dp + 1)}`));
  }

  const flagged = new Set(o.flagged || []);
  const picked = new Set(o.picked || []);
  values.forEach((v, i) => {
    els.push(
      pointMark(X(v), base - r - 3 - level[i] * (2 * r + 2), r, {
        index: i,
        pickable: !!o.pick,
        picked: o.pick ? o.pick.selected.has(i) : picked.has(i),
        flagged: flagged.has(i),
        label: `${num(v, o.series.dp)} ${o.series.unit}`,
      }),
    );
  });
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "ds-svg", role: o.pick ? "group" : "img", "aria-label": o.label }, els);
}

/** A −1 to +1 scale with the player's guess (circle) and the computed r (diamond). */
function rStrip(guess, r, width) {
  const W = width;
  const H = 46;
  const pad = 22;
  const X = (v) => pad + ((v + 1) / 2) * (W - 2 * pad);
  const y = 20;
  const els = [svg("line", { x1: X(-1), x2: X(1), y1: y, y2: y, class: "ds-axis" })];
  [-1, -0.5, 0, 0.5, 1].forEach((v) => {
    els.push(svg("line", { x1: X(v), x2: X(v), y1: y - 4, y2: y + 4, class: "ds-axis" }));
    els.push(svg("text", { x: X(v), y: y + 20, class: "ds-tick", "text-anchor": "middle" }, v === 0 ? "0" : (v > 0 ? "+" : MINUS) + String(Math.abs(v))));
  });
  if (r !== null) {
    els.push(svg("line", { x1: X(guess), x2: X(r), y1: y, y2: y, class: "ds-gap" }));
    els.push(svg("path", { d: diamond(X(r), y, 7), class: "ds-strip-r" }));
  }
  els.push(svg("circle", { cx: X(guess), cy: y, r: 5.5, class: "ds-strip-you" }));
  const label = r === null ? `Your guess ${fmtR(guess)}` : `Your guess ${fmtR(guess)}, computed r ${fmtR(r)}`;
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "ds-svg ds-strip", role: "img", "aria-label": label }, els);
}

function metric(label, value, state) {
  return h("div", { class: "g-metric", dataset: state ? { state } : {} }, h("span", { class: "g-metric-label" }, label), h("span", { class: "g-metric-value" }, value));
}

/** Redraw on resize so charts keep fitting the screen. */
function onResize(ctx, fn) {
  let timer = null;
  let lastWidth = window.innerWidth;
  const handler = () => {
    if (window.innerWidth === lastWidth) return; // ignore height-only changes (mobile toolbars, iframe growth)
    lastWidth = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(fn, 150);
  };
  window.addEventListener("resize", handler);
  ctx.onCleanup(() => {
    clearTimeout(timer);
    window.removeEventListener("resize", handler);
  });
}

const stripLegend = () =>
  h(
    "p",
    { class: "ds-legend" },
    h("span", { class: "ds-key ds-key-you", "aria-hidden": "true" }, "●"),
    " your guess   ",
    h("span", { class: "ds-key ds-key-r", "aria-hidden": "true" }, "◆"),
    " computed r",
  );

const markLegend = () =>
  h(
    "p",
    { class: "ds-legend" },
    h("span", { class: "ds-key ds-key-r", "aria-hidden": "true" }, "◆"),
    " flagged by the rule   ",
    h("span", { class: "ds-key", "aria-hidden": "true" }, "▢"),
    " your pick",
  );

// ---------------------------------------------------------------- Guess r

const TRAP_NAMES = { curve: "a curve", makes: "one point makes it", breaks: "one point hides it", restricted: "a narrow sample", lurking: "a hidden third factor" };

/** What the reveal says about a plot, beyond the number. */
function explainScatter(it) {
  const s = it.story;
  if (it.kind === "curve") {
    return `<b>Trap: a curve.</b> ${s.why} The pattern is strong, but it is not a straight line, so r comes out near 0. Never read “r is about 0” as “no relationship” without looking at the plot.`;
  }
  if (it.kind === "makes") {
    return `<b>Trap: one point makes the correlation.</b> The circled point sits far from the rest. Without it, r = ${fmtR(it.rWithout)} (the dashed line). One unusual record created most of this correlation.`;
  }
  if (it.kind === "breaks") {
    return `<b>Trap: one point hides the correlation.</b> Without the circled point, r = ${fmtR(it.rWithout)} (the dashed line). One record far off the trend dragged r toward 0.`;
  }
  if (it.kind === "restricted") {
    return `<b>Trap: a narrow sample.</b> Only ${s.things} with ${lower(s.x.label)} from ${num(it.window[0], s.x.dp)} to ${withUnit(s.x, it.window[1])} were sampled (the shaded band). Across the full range (hollow points), r = ${fmtR(it.rFull)}. Looking at a thin slice of x makes a real relationship look weak.`;
  }
  if (it.kind === "lurking") return `<b>Strong, but is it cause and effect?</b> ${s.why}`;
  if (Math.abs(it.r) < 0.1) return "No straight-line trend here: knowing x tells you almost nothing about y.";
  return `The points ${Math.abs(it.r) >= 0.8 ? "hug" : "scatter loosely around"} a line that slopes ${it.r > 0 ? "up" : "down"}: ${describeR(it.r)}.`;
}

/** Overlays for the revealed scatter of a Guess r plot. */
function revealOptions(it) {
  const xs = it.points.map((p) => p.x);
  const ys = it.points.map((p) => p.y);
  const o = { lines: [{ ...leastSquares(xs, ys), cls: "" }] };
  if (it.kind === "curve") o.curve = (x) => curveY(it.story, x);
  if (it.kind === "makes" || it.kind === "breaks") {
    const rest = it.points.filter((_, i) => i !== it.planted);
    o.lines.push({ ...leastSquares(rest.map((p) => p.x), rest.map((p) => p.y)), cls: "is-alt" });
    o.circled = it.planted;
  }
  if (it.kind === "restricted") {
    o.ghost = it.outside;
    o.band = it.window;
  }
  return o;
}

function playGuess(ctx, round) {
  const answers = [];
  let index = 0;
  let redraw = () => {};
  onResize(ctx, () => redraw());

  function status() {
    const s = guessSummary(answers);
    ctx.setStatus(
      h(
        "div",
        { class: "g-metrics" },
        metric("Plot", `${Math.min(index + 1, round.items.length)} of ${round.items.length}`),
        metric("Points", String(s.points)),
        metric("Streak", String(s.streak), s.streak >= 2 ? "good" : null),
      ),
    );
  }

  function show() {
    const it = round.items[index];
    let guess = 0;
    let locked = false;
    const plot = h("div", { class: "ds-plot" });
    const valueOut = h("output", { class: "ds-guess-value", for: "ds-r" });
    const words = h("span", { class: "ds-guess-words" });
    const slider = h("input", { type: "range", id: "ds-r", class: "ds-slider", min: "-1", max: "1", step: String(GUESS_STEP), value: "0" });
    const lockBtn = h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: lock }, "Lock in guess");
    const feedback = h("div", { class: "ds-feedback", role: "status" });
    const strip = h("div", { class: "ds-strip-wrap" });

    function readSlider() {
      guess = snapGuess(Number(slider.value));
      valueOut.textContent = `r = ${fmtR(guess)}`;
      words.textContent = describeR(guess);
      slider.setAttribute("aria-valuetext", `${fmtR(guess)}, ${describeR(guess)}`);
    }
    slider.addEventListener("input", readSlider);
    slider.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault(); // or the same key press would also activate the Next button that gets focus
      lock();
    });

    redraw = () => {
      const width = chartWidth(plot);
      const base = {
        width,
        story: it.story,
        label: `Scatter plot of ${lower(it.story.y.label)} against ${lower(it.story.x.label)} for ${it.n} ${it.story.things}.${locked ? ` Computed r is ${fmtR(it.r)}.` : ""}`,
      };
      replace(plot, scatterPlot(it.points, locked ? { ...base, ...revealOptions(it) } : base));
      if (locked) replace(strip, rStrip(guess, it.r, Math.min(width, 460)), stripLegend());
    };

    function lock() {
      if (locked) return;
      locked = true;
      readSlider();
      answers.push({ guess, r: it.r, kind: it.kind });
      const err = Math.abs(guess - it.r);
      const pts = guessPoints(guess, it.r);
      const close = isClose(guess, it.r);
      const last = index === round.items.length - 1;
      slider.disabled = true;
      lockBtn.hidden = true;
      const next = h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: advance }, last ? "See results" : "Next plot");
      replace(
        feedback,
        h(
          "div",
          { class: `ds-result ${close ? "is-good" : "is-off"}` },
          h(
            "p",
            { class: "ds-result-head" },
            h("b", {}, `Computed r = ${fmtR(it.r)}`),
            ` (${describeR(it.r)}). You guessed ${fmtR(guess)}: off by ${fmt(err, 2)}. `,
            h("b", {}, `${close ? "✔ Close" : "✖ Not close"}, +${pts} points.`),
          ),
          strip,
          h("p", { class: "ds-explain", html: explainScatter(it) }),
          h("div", { class: "g-actions" }, next),
        ),
      );
      redraw();
      status();
      ctx.announce(`Computed r is ${fmtR(it.r)}. You were off by ${fmt(err, 2)}.`);
      next.focus({ preventScroll: true });
    }

    replace(
      ctx.stage,
      h(
        "div",
        { class: "g-card ds-card" },
        h("h2", { class: "ds-title" }, `Plot ${index + 1}: ${pairTitle(it.story)}`),
        h("p", { class: "ds-sub" }, `Each point is one of ${it.n} ${it.story.things}. How strong is the straight-line relationship?`),
        plot,
        h(
          "div",
          { class: "ds-guess" },
          h("div", { class: "ds-guess-head" }, h("label", { for: "ds-r" }, "Your guess for r"), valueOut, words),
          slider,
          h("div", { class: "ds-scale", "aria-hidden": "true" }, ["−1", "−0.5", "0", "+0.5", "+1"].map((t) => h("span", {}, t))),
          lockBtn,
        ),
        feedback,
      ),
    );
    readSlider();
    redraw();
    status();
  }

  function advance() {
    index += 1;
    if (index < round.items.length) {
      show();
      ctx.stage.querySelector(".ds-slider")?.focus({ preventScroll: true });
    } else finishGuess(ctx, round, answers);
  }

  show();
}

function finishGuess(ctx, round, answers) {
  const s = guessSummary(answers);
  const stars = starsForGuess(s.meanError);
  const items = round.items;
  const zeroError = mean(items.map((it) => Math.abs(it.r)));
  const tag = (it) => (TRAP_NAMES[it.kind] ? ` (${TRAP_NAMES[it.kind]})` : "");
  const width = Math.min(420, chartWidth(document.querySelector(".g-screen")) - 24);

  const figure = h(
    "div",
    { class: "g-card ds-recap" },
    h("h2", { class: "ds-title" }, "Your guesses against the computed r"),
    items.map((it, i) =>
      h("div", { class: "ds-recap-row" }, h("span", { class: "ds-recap-name" }, `${i + 1}. ${pairTitle(it.story)}${tag(it)}`), rStrip(answers[i].guess, it.r, width)),
    ),
    stripLegend(),
  );

  // Pick this round's examples for the debrief.
  const errs = answers.map((a) => Math.abs(a.guess - a.r));
  const worst = errs.indexOf(Math.max(...errs));
  const strongest = items.reduce((b, it, i) => (Math.abs(it.r) > Math.abs(items[b].r) ? i : b), 0);
  const find = (kind) => items.findIndex((it) => it.kind === kind);
  const curve = find("curve");
  const makes = find("makes");
  const breaks = find("breaks");
  const restricted = find("restricted");
  const lurking = find("lurking");

  const measures = [
    `<p><b>Pearson's r</b> says how closely the points follow a straight line. The sign gives the direction (up or down), and the size, from 0 to 1, gives how tightly the points hug the line.</p>`,
    `<p class="g-formula">r = sum of (z-score of x × z-score of y) ÷ (n − 1)</p>`,
    `<p>Your biggest miss was plot ${worst + 1}: you guessed ${fmtR(answers[worst].guess)} and r was ${fmtR(items[worst].r)}. A cloud that looks “pretty clear” is often only r = 0.5 to 0.7. The points have to sit almost on the line before r passes 0.9.</p>`,
  ];
  if (curve >= 0) {
    measures.push(
      `<p>Plot ${curve + 1} had an obvious curve, yet r = ${fmtR(items[curve].r)}. r only measures <b>straight-line</b> association, so always plot the data before you trust the number.</p>`,
    );
  }

  let influence;
  if (makes >= 0 || breaks >= 0) {
    const parts = [];
    if (makes >= 0) parts.push(`In plot ${makes + 1}, one far point lifted r from ${fmtR(items[makes].rWithout)} to ${fmtR(items[makes].r)}.`);
    if (breaks >= 0) parts.push(`In plot ${breaks + 1}, one off-trend point pulled r from ${fmtR(items[breaks].rWithout)} to ${fmtR(items[breaks].r)}.`);
    influence = `<p>${parts.join(" ")} r is built from distances to the averages, so a point far from the rest counts much more than a typical point.</p>`;
    if (restricted >= 0) {
      influence += `<p>The opposite problem is a sample that is too narrow. Plot ${restricted + 1} showed r = ${fmtR(items[restricted].r)}, but across the full range r = ${fmtR(items[restricted].rFull)}.</p>`;
    }
  } else {
    influence = `<p>r is built from distances to the averages, so a point far from the rest counts much more than a typical point. One odd record can create a correlation that isn't there, or hide one that is. Level 3 has both, and Level 6 lets you remove the point and watch r change.</p>`;
  }

  const causeIndex = lurking >= 0 ? lurking : strongest;
  const cs = items[causeIndex].story;
  const cause =
    lurking >= 0
      ? `<p>Plot ${lurking + 1} had r = ${fmtR(items[lurking].r)}. ${cs.why}</p><p>A strong r tells you two measurements move together. It can't tell you why. Before claiming cause and effect, look for a third factor behind both, and ask whether the arrow could point the other way.</p>`
      : `<p>In plot ${causeIndex + 1}, ${lower(cs.x.label)} and ${lower(cs.y.label)} moved together (r = ${fmtR(items[causeIndex].r)}). That alone doesn't prove one causes the other. A third factor could drive both, or the arrow could point the other way. To show cause, engineers change one thing on purpose and hold the rest steady: an experiment.</p>`;

  ctx.finish({
    outcome: stars === 3 ? "win" : stars === 0 ? "miss" : "ok",
    stars,
    headline: `${["Keep practicing", "Getting there", "Good eye", "Sharp eye"][stars]}: off by ${fmt(s.meanError, 2)} on average`,
    summary: `You scored <b>${s.points} of ${s.count * 100} points</b>. ${s.close} of ${s.count} guesses were within ${CLOSE.toFixed(2)} of the computed r, and your longest streak was ${s.longestStreak}. For comparison, answering 0 every time would have been off by ${fmt(zeroError, 2)} on average.`,
    comparison: {
      caption: "Your guess next to Pearson's r computed from the plotted points",
      columns: ["Your guess", "Computed r", "Off by"],
      rows: [
        ...items.map((it, i) => ({ label: `${i + 1}. ${pairTitle(it.story)}${tag(it)}`, values: [fmtR(answers[i].guess), fmtR(it.r), fmt(errs[i], 2)] })),
        { label: "Average", values: ["", "", fmt(s.meanError, 2)] },
      ],
    },
    figure,
    debrief: [
      { title: "What r measures", body: measures.join("") },
      { title: "One point can move r a lot", body: influence },
      { title: "Correlation is not causation", body: cause },
    ],
  });
}

// ---------------------------------------------------------------- Find the Outlier

const RULE_TEXT = {
  iqr: `Rule on this level: a value is an outlier if it lies more than ${IQR_K} × IQR below the first quartile or above the third quartile.`,
  z: `Rule on this level: a value is an outlier if it is more than ${Z_LIMIT} standard deviations from the mean.`,
  box: `Rule on this level: a point is an outlier if its x value or its y value lies more than ${IQR_K} × IQR beyond the quartiles of that axis.`,
};

const isScatter = (it) => it.rule === "box";
const itemTitle = (it) => (isScatter(it) ? pairTitle(it.story) : `${it.series.label} (${it.series.unit})`);
const pointText = (it, i) => (isScatter(it) ? `(${num(it.points[i].x, it.story.x.dp)}, ${num(it.points[i].y, it.story.y.dp)})` : num(it.values[i], it.series.dp));
/** The chosen points as text, smallest value (or x) first. */
const listText = (it, idx) => {
  const key = isScatter(it) ? (i) => it.points[i].x : (i) => it.values[i];
  return idx.length ? [...idx].sort((a, b) => key(a) - key(b) || a - b).map((i) => pointText(it, i)).join(", ") : "none";
};
/** Keyboard order for picking: left to right. */
const pickOrder = (it) => {
  const key = isScatter(it) ? (i) => it.points[i].x : (i) => it.values[i];
  return Array.from({ length: it.n }, (_, i) => i).sort((a, b) => key(a) - key(b) || a - b);
};

function outlierPlot(it, o) {
  if (isScatter(it)) {
    const label = `Scatter plot of ${lower(it.story.y.label)} against ${lower(it.story.x.label)} for ${it.n} ${it.story.things}.`;
    if (!o.reveal) return scatterPlot(it.points, { width: o.width, story: it.story, pick: o.pick, label: `${label} Pick the outliers.` });
    const xs = it.points.map((p) => p.x);
    const ys = it.points.map((p) => p.y);
    const kept = it.points.filter((_, i) => !it.outliers.includes(i));
    const lines = [{ ...leastSquares(xs, ys), cls: "" }];
    if (it.outliers.length) lines.push({ ...leastSquares(kept.map((p) => p.x), kept.map((p) => p.y)), cls: "is-alt" });
    return scatterPlot(it.points, {
      width: o.width,
      story: it.story,
      box: { x: fences(xs), y: fences(ys) },
      lines,
      flagged: it.outliers,
      picked: o.picked,
      label: `${label} The rule flags ${plural(it.outliers.length, "point")}.`,
    });
  }
  const label = `Dot plot of ${it.n} values of ${lower(it.series.label)} in ${it.series.unit}.`;
  if (!o.reveal) return dotPlot(it.values, { width: o.width, series: it.series, pick: o.pick, label: `${label} Pick the outliers.` });
  return dotPlot(it.values, {
    width: o.width,
    series: it.series,
    rule: it.rule,
    flagged: it.outliers,
    picked: o.picked,
    label: `${label} The rule flags ${plural(it.outliers.length, "value")}.`,
  });
}

/** The rule worked out with this dataset's numbers (HTML). */
function ruleWorking(it) {
  const flaggedText = it.outliers.length ? `<b>${plural(it.outliers.length, isScatter(it) ? "point" : "value")}</b>: ${listText(it, it.outliers)}` : "<b>nothing</b>";
  if (it.rule === "z") {
    const dp = it.series.dp + 1;
    const mu = mean(it.values);
    const s = sd(it.values);
    const byBox = iqrOutliers(it.values);
    let note = "";
    if (byBox.length > it.outliers.length) {
      note = `<p>The box-plot rule would flag ${plural(byBox.length, "value")} here (${listText(it, byBox)}). An outlier inflates the very standard deviation it is measured against, so in a small sample the 3-sigma rule often misses it.</p>`;
    }
    return `<p class="g-formula">mean = ${num(mu, dp)}, SD = ${num(s, dp)}; limits = ${num(mu, dp)} ± ${Z_LIMIT} × ${num(s, dp)} = ${num(mu - Z_LIMIT * s, dp)} to ${num(mu + Z_LIMIT * s, dp)}</p><p>The 3-sigma rule flags ${flaggedText}.</p>${note}`;
  }
  const line = (name, values, dp) => {
    const f = fences(values);
    return `<p class="g-formula">${name}Q1 = ${num(f.q1, dp)}, Q3 = ${num(f.q3, dp)}, IQR = ${num(f.iqr, dp)}; fences = ${num(f.q1, dp)} − ${IQR_K} × ${num(f.iqr, dp)} = ${num(f.lo, dp)} and ${num(f.q3, dp)} + ${IQR_K} × ${num(f.iqr, dp)} = ${num(f.hi, dp)}</p>`;
  };
  if (isScatter(it)) {
    return `${line("x: ", it.points.map((p) => p.x), it.story.x.dp + 1)}${line("y: ", it.points.map((p) => p.y), it.story.y.dp + 1)}<p>The dashed box shows the fences. The rule flags ${flaggedText}.</p>`;
  }
  let note = "";
  if (it.kind === "near" && !it.outliers.length) note = "<p>The value at the edge looks lonely, but it is still inside the fence.</p>";
  if (it.kind === "skew" && it.outliers.length) note = "<p>This data has a long right tail, so the rule flags the slow end. Those may be real, rare delays rather than mistakes.</p>";
  return `${line("", it.values, it.series.dp + 1)}<p>The rule flags ${flaggedText}.</p>${note}`;
}

/** What removing the flagged points does to the summary (an element, or null). */
function effectTable(it) {
  if (!it.outliers.length) return h("p", { class: "ds-explain" }, "Nothing is flagged, so there is nothing to remove and the summary stays as it is.");
  if (isScatter(it)) {
    return h(
      "p",
      { class: "ds-explain" },
      "With every point, ",
      h("b", {}, `r = ${fmtR(it.r)}`),
      " (solid line). Without the flagged ",
      it.outliers.length === 1 ? "point" : "points",
      ", ",
      h("b", {}, `r = ${fmtR(it.rKept)}`),
      " (dashed line).",
    );
  }
  const s = summaryWithout(it.values, it.outliers);
  const dp = it.series.dp + 1;
  const row = (name, key) => h("tr", {}, h("th", { scope: "row" }, name), h("td", {}, num(s.all[key], dp)), h("td", {}, num(s.kept[key], dp)));
  return h(
    "div",
    { class: "g-table-wrap" },
    h(
      "table",
      { class: "g-table ds-effect" },
      h("caption", {}, `What the flagged ${it.outliers.length === 1 ? "value does" : "values do"} to the summary (${it.series.unit})`),
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, ""), h("th", { scope: "col" }, `All ${s.all.n} values`), h("th", { scope: "col" }, "Without flagged"))),
      h("tbody", {}, row("Mean", "mean"), row("Median", "median"), row("Standard deviation", "sd")),
    ),
  );
}

const verdictText = (sc) => {
  if (sc.exact) return "✔ Your picks match the rule exactly.";
  const parts = [];
  if (sc.missed) parts.push(`missed ${sc.missed}`);
  if (sc.extra) parts.push(`picked ${sc.extra} the rule doesn't flag`);
  return `✖ You ${parts.join(" and ")}.`;
};

function playOutliers(ctx, round) {
  const results = [];
  let index = 0;
  let redraw = () => {};
  onResize(ctx, () => redraw());

  function status() {
    const exact = results.filter((r) => r.score.exact).length;
    ctx.setStatus(
      h("p", { class: "ds-rule" }, RULE_TEXT[round.rule]),
      h(
        "div",
        { class: "g-metrics" },
        metric("Dataset", `${Math.min(index + 1, round.items.length)} of ${round.items.length}`),
        metric("Exact matches", `${exact} of ${results.length}`, results.length && exact === results.length ? "good" : null),
      ),
    );
  }

  function show() {
    const it = round.items[index];
    const selected = new Set();
    let checked = false;
    const plot = h("div", { class: "ds-plot" });
    const pickedLine = h("p", { class: "ds-picked", "aria-live": "polite" });
    const checkBtn = h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: check }, "Check my picks");
    const clearBtn = h("button", { type: "button", class: "g-btn", onclick: clear }, "Clear picks");
    const feedback = h("div", { class: "ds-feedback", role: "status" });

    function showPicked() {
      pickedLine.textContent = `Picked: ${listText(it, [...selected])}${isScatter(it) || !selected.size ? "" : ` ${it.series.unit}`}`;
      clearBtn.disabled = !selected.size;
    }

    redraw = () => {
      const width = chartWidth(plot);
      if (checked) {
        replace(plot, outlierPlot(it, { width, reveal: true, picked: [...selected] }));
        return;
      }
      const el = outlierPlot(it, { width, pick: { selected } });
      replace(plot, el);
      wirePicking(el, pickOrder(it), selected, showPicked);
    };

    function clear() {
      selected.clear();
      showPicked();
      redraw();
    }

    function check() {
      if (checked) return;
      checked = true;
      const score = scorePicks([...selected], it.outliers);
      results.push({ picked: [...selected], score });
      const last = index === round.items.length - 1;
      checkBtn.hidden = true;
      clearBtn.hidden = true;
      const next = h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: advance }, last ? "See results" : "Next dataset");
      replace(
        feedback,
        h(
          "div",
          { class: `ds-result ${score.exact ? "is-good" : "is-off"}` },
          h("p", { class: "ds-result-head" }, h("b", {}, verdictText(score))),
          markLegend(),
          h("div", { html: ruleWorking(it) }),
          effectTable(it),
          h("div", { class: "g-actions" }, next),
        ),
      );
      redraw();
      status();
      ctx.announce(`${verdictText(score)} The rule flags ${listText(it, it.outliers)}.`);
      next.focus({ preventScroll: true });
    }

    const what = isScatter(it) ? `Each point is one of ${it.n} ${it.story.things}.` : `${it.n} measurements.`;
    replace(
      ctx.stage,
      h(
        "div",
        { class: "g-card ds-card" },
        h("h2", { class: "ds-title" }, `Dataset ${index + 1}: ${itemTitle(it)}`),
        h("p", { class: "ds-sub" }, `${what} Tap every point you think the rule flags. If nothing looks out of place, pick none.`),
        plot,
        pickedLine,
        h("div", { class: "g-actions ds-check" }, checkBtn, clearBtn),
        feedback,
      ),
    );
    showPicked();
    redraw();
    status();
  }

  function advance() {
    index += 1;
    if (index < round.items.length) {
      show();
      ctx.stage.querySelector('.ds-pick[tabindex="0"]')?.focus({ preventScroll: true });
    } else finishOutliers(ctx, round, results);
  }

  show();
}

function finishOutliers(ctx, round, results) {
  const items = round.items;
  const avg = mean(results.map((r) => r.score.score));
  const exact = results.filter((r) => r.score.exact).length;
  const stars = starsForPicks(avg);
  const totals = results.reduce((t, r) => ({ missed: t.missed + r.score.missed, extra: t.extra + r.score.extra }), { missed: 0, extra: 0 });
  const width = Math.min(340, chartWidth(document.querySelector(".g-screen")) - 24);
  const ruleName = { iqr: `${IQR_K} × IQR rule`, z: `${Z_LIMIT}-sigma rule`, box: `${IQR_K} × IQR rule on each axis` }[round.rule];

  const figure = h(
    "div",
    { class: "g-card ds-recap" },
    h("h2", { class: "ds-title" }, "Every dataset with the rule drawn in"),
    h(
      "div",
      { class: "ds-recap-grid" },
      items.map((it, i) =>
        h("figure", { class: "ds-recap-fig" }, h("figcaption", {}, `${i + 1}. ${itemTitle(it)}`), outlierPlot(it, { width, reveal: true, picked: results[i].picked })),
      ),
    ),
    markLegend(),
  );

  // Worked example: the first dataset where the rule flags something.
  const example = Math.max(0, items.findIndex((it) => it.outliers.length > 0));
  const ex = items[example];
  const ruleIntro = {
    iqr: `<p>The <b>interquartile range</b> (IQR) is the width of the middle half of the data: Q3 − Q1. The rule puts a fence ${IQR_K} IQRs beyond each quartile and flags anything outside. A box plot draws exactly this.</p>`,
    z: `<p>The <b>z-score</b> of a value is how many standard deviations it sits from the mean. The rule flags a value when its z-score is beyond ±${Z_LIMIT}.</p>`,
    box: `<p>On a scatter plot, this game applies the box-plot rule to each axis in turn. A point outside the dashed fence box on either axis is flagged.</p>`,
  }[round.rule];

  const debrief = [{ title: `The ${ruleName}`, body: `${ruleIntro}<p>Dataset ${example + 1}, ${lower(itemTitle(ex))}:</p>${ruleWorking(ex)}` }];

  if (round.rule === "box") {
    const k = items.reduce((b, it, i) => (Math.abs(it.r - it.rKept) > Math.abs(items[b].r - items[b].rKept) ? i : b), 0);
    debrief.push({
      title: "One point can move r a lot",
      body: `<p>In dataset ${k + 1}, r was ${fmtR(items[k].r)} with every point and ${fmtR(items[k].rKept)} without the flagged ${items[k].outliers.length === 1 ? "point" : "points"}. r is built from distances to the averages, so a far point counts much more than a typical one. It can create a correlation, or hide one.</p><p>This rule looks at one axis at a time. A point can be ordinary on both axes and still sit far off the trend, and the rule will not flag it. That is why you plot the data as well.</p>`,
    });
    debrief.push({
      title: "Correlation is not causation",
      body: `<p>Even a clean, strong r only says two measurements move together. It doesn't say one causes the other: a third factor may drive both. Cleaning the data fixes the number, not the reasoning.</p>`,
    });
  } else {
    const shift = (it) => {
      const s = summaryWithout(it.values, it.outliers);
      return { s, meanMove: Math.abs(s.all.mean - s.kept.mean), medianMove: Math.abs(s.all.median - s.kept.median), spread: s.kept.sd || 1 };
    };
    const k = items.reduce((b, it, i) => (shift(it).meanMove / shift(it).spread > shift(items[b]).meanMove / shift(items[b]).spread ? i : b), 0);
    const sk = shift(items[k]);
    const dp = items[k].series.dp + 1;
    const body =
      items[k].outliers.length > 0
        ? `<p>In dataset ${k + 1}, removing the flagged ${items[k].outliers.length === 1 ? "value" : "values"} moved the <b>mean</b> from ${num(sk.s.all.mean, dp)} to ${num(sk.s.kept.mean, dp)} ${items[k].series.unit}, but the <b>median</b> only from ${num(sk.s.all.median, dp)} to ${num(sk.s.kept.median, dp)}. The standard deviation fell from ${num(sk.s.all.sd, dp)} to ${num(sk.s.kept.sd, dp)}.</p><p>The mean and standard deviation use every value's distance, so one far value drags them. The median and IQR only use the order of the values, so they barely move. They are <b>resistant</b>.</p>`
        : `<p>The rule flagged nothing in this round, so no summary changed. When a far value is present, the mean and standard deviation move a lot, while the median and IQR barely move. They are <b>resistant</b>.</p>`;
    debrief.push({ title: "What an outlier does to a summary", body });
    if (round.rule === "z") {
      const extraByBox = items.reduce((t, it) => t + Math.max(0, iqrOutliers(it.values).length - it.outliers.length), 0);
      debrief.push({
        title: "Two rules, two answers",
        body: `<p>Across this round the 3-sigma rule flagged ${plural(items.reduce((t, it) => t + it.outliers.length, 0), "value")}. The box-plot rule would have flagged ${extraByBox} more. An outlier inflates the mean and standard deviation that the 3-sigma rule uses, so it can hide itself, and two outliers can hide each other. This is called <b>masking</b>.</p><p>With fewer than 11 values, no value can ever be more than 3 standard deviations from the mean. The 3-sigma rule suits large samples; the box-plot rule works on small ones too.</p>`,
      });
    }
  }
  debrief.push({
    title: "Flag first, then investigate",
    body: `<p>A rule only <b>flags</b> a point. It doesn't tell you what to do with it. Find out why it is unusual: a typing mistake, a sensor glitch, a different product, or a real rare event. Remove it only when you have a reason, and say so in your report. Sometimes the outlier is the most important point in the data.</p>`,
  });

  ctx.finish({
    outcome: stars === 3 ? "win" : stars === 0 ? "miss" : "ok",
    stars,
    headline: exact === items.length ? "Every pick matched the rule" : `${exact} of ${items.length} datasets matched the rule exactly`,
    summary: `You were checked against the <b>${ruleName}</b>. ${
      totals.missed + totals.extra === 0
        ? "You flagged exactly what the rule flags, every time."
        : `Across the round you missed ${plural(totals.missed, "flagged point")} and picked ${plural(totals.extra, "point")} the rule leaves alone.`
    }`,
    comparison: {
      caption: `Your picks next to the outliers found by the ${ruleName}`,
      columns: ["Your picks", "Rule's outliers", "Result"],
      rows: items.map((it, i) => ({
        label: `${i + 1}. ${itemTitle(it)}`,
        values: [listText(it, results[i].picked), listText(it, it.outliers), results[i].score.exact ? "✔ match" : `✖ ${results[i].score.missed} missed, ${results[i].score.extra} extra`],
      })),
    },
    figure,
    debrief,
  });
}

// Created last, so every helper above exists even when ?autostart=1 starts a round right away.
createGame({
  slug: "data-sense",
  title: "Data Sense",
  tagline: "Train your eye for scatter plots, then hunt for the points that don't belong.",
  objective:
    "estimate the correlation r from a scatter plot, flag outliers with the 1.5 × IQR and 3-sigma rules, and explain why a strong r is not proof of cause and effect.",
  minutes: "10-15",
  chapter: { href: "../../chapters/week-11.html", label: "Week 11 · Working with Data: Spreadsheets and Python" },
  howToPlay: [
    "The level you choose sets the mode. <b>Levels 1 to 3 are Guess r</b>: study a scatter plot, slide to your guess for the correlation r (from −1 to +1), and lock it in.",
    `A guess within ${CLOSE.toFixed(2)} of the computed r is <b>close</b> and keeps your streak going. Level 3 hides traps: curves, single odd points, and narrow samples.`,
    "<b>Levels 4 to 6 are Find the Outlier</b>: tap every point you think the rule will flag, or none if nothing looks out of place, then check your picks.",
    "Keyboard: the slider moves with the arrow keys. In a plot, the arrow keys step between points and <kbd>Space</kbd> picks one.",
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start(ctx) {
    const round = generateRound(ctx.rng, ctx.level);
    if (round.mode === "guess") playGuess(ctx, round);
    else playOutliers(ctx, round);
  },
});
