// Draw the Boundary: separate failing machines from healthy ones by hand,
// then see how the boundary does on machines it has never seen.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt, pct } from "../shared/dom.js";
import {
  ASSUMPTIONS,
  AXES,
  LEVELS,
  KS,
  MAX_BENDS,
  truthY,
  generateRound,
  errorOf,
  straightBoundary,
  boundaryPredictor,
  bends,
  addBend,
  addBendInWidestGap,
  removeBend,
  moveControl,
  fitLogistic,
  logisticScore,
  logisticPredictor,
  knnPredictAll,
  knnCurve,
  bestIndex,
  starsFor,
  evaluateBoundary,
  referenceModels,
} from "./logic.js";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const share = (e) => `${e.wrong} of ${e.n} (${pct(e.rate, 1)})`;
/** A difference between two error rates, in percentage points. */
const points = (d) => `${fmt(100 * d, 1)} points`;
const toUnit = (axis, v) => axis.min + v * (axis.max - axis.min);
const inUnits = (p) => `${fmt(toUnit(AXES.x, p.x), AXES.x.dp)} ${AXES.x.unit}, ${fmt(toUnit(AXES.y, p.y), AXES.y.dp)} ${AXES.y.unit}`;
const noiseText = (noise) => (noise ? `About ${Math.round(noise * 100)}% of the records have the wrong label.` : "Every record has the right label.");

// ---------------------------------------------------------------- drawing helpers

function chartWidth(el, max = 640) {
  const w = el && el.clientWidth ? el.clientWidth : max;
  return Math.round(Math.min(max, Math.max(260, w)));
}

/** Pixel geometry of the plot for a given width. u and v are plot units (0 to 1). */
function geometry(W) {
  const H = Math.round(Math.min(440, Math.max(250, W * (W < 420 ? 0.9 : 0.74)))); // taller on phones, for easier dragging
  const m = { l: 46, r: 10, t: 10, b: 42 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  return { W, H, m, pw, ph, X: (u) => m.l + u * pw, Y: (v) => m.t + (1 - v) * ph };
}

/** Frame, grid, tick labels, and axis titles. */
function axesLayer(g) {
  const { W, H, m, pw, ph, X, Y } = g;
  const els = [svg("rect", { x: m.l, y: m.t, width: pw, height: ph, class: "db-frame" })];
  const xStep = W < 400 ? 2.5 : 2;
  for (let v = AXES.x.min; v <= AXES.x.max + 1e-9; v += xStep) {
    const px = X((v - AXES.x.min) / (AXES.x.max - AXES.x.min));
    els.push(svg("line", { x1: px, x2: px, y1: m.t, y2: m.t + ph, class: "db-grid" }));
    els.push(svg("text", { x: px, y: m.t + ph + 15, class: "db-tick", "text-anchor": "middle" }, String(v)));
  }
  for (let v = AXES.y.min; v <= AXES.y.max + 1e-9; v += 10) {
    const py = Y((v - AXES.y.min) / (AXES.y.max - AXES.y.min));
    els.push(svg("line", { x1: m.l, x2: m.l + pw, y1: py, y2: py, class: "db-grid" }));
    els.push(svg("text", { x: m.l - 6, y: py + 4, class: "db-tick", "text-anchor": "end" }, String(v)));
  }
  els.push(svg("text", { x: m.l + pw / 2, y: H - 8, class: "db-axis-title", "text-anchor": "middle" }, `${AXES.x.label} (${AXES.x.unit})`));
  const cy = m.t + ph / 2;
  els.push(svg("text", { x: 13, y: cy, class: "db-axis-title", "text-anchor": "middle", transform: `rotate(-90 13 ${cy})` }, `${AXES.y.label} (${AXES.y.unit})`));
  return els;
}

const triangle = (cx, cy, r) => `M${cx},${cy - r * 1.15} L${cx + r},${cy + r * 0.75} L${cx - r},${cy + r * 0.75} z`;

/** One machine: circle = healthy, triangle = fails. Test machines are smaller and hollow. */
function machine(g, p, kind = "train") {
  const cx = g.X(p.x);
  const cy = g.Y(p.y);
  const r = kind === "test" ? 3 : g.W < 400 ? 4.2 : 4.8;
  const cls = `db-pt ${p.label ? "is-fails" : "is-healthy"} is-${kind}`;
  return p.label ? svg("path", { d: triangle(cx, cy, r), class: cls }) : svg("circle", { cx, cy, r, class: cls });
}

const boundaryPath = (g, ctrl) => ctrl.map((c, i) => `${i ? "L" : "M"}${g.X(c.x).toFixed(1)},${g.Y(c.y).toFixed(1)}`).join("");
const regionPoints = (g, ctrl) => [...ctrl.map((c) => `${g.X(c.x).toFixed(1)},${g.Y(c.y).toFixed(1)}`), `${g.X(1)},${g.Y(1)}`, `${g.X(0)},${g.Y(1)}`].join(" ");

/** Path of the curve where score(point) = 0, found column by column. */
function contourPath(g, score) {
  const cols = 100;
  const rows = 160;
  let prev = null;
  let d = "";
  for (let i = 0; i <= cols; i++) {
    const x = i / cols;
    const ys = [];
    let last = score({ x, y: 0 });
    for (let j = 1; j <= rows; j++) {
      const y = j / rows;
      const s = score({ x, y });
      if ((s > 0) !== (last > 0)) ys.push(y - (1 / rows) * (s / (s - last)));
      last = s;
    }
    if (prev && prev.ys.length === ys.length) {
      ys.forEach((y, k) => {
        d += `M${g.X(prev.x).toFixed(1)},${g.Y(prev.ys[k]).toFixed(1)}L${g.X(x).toFixed(1)},${g.Y(y).toFixed(1)}`;
      });
    }
    prev = { x, ys };
  }
  return d;
}

const truthPath = (g, truth) =>
  Array.from({ length: 81 }, (_, i) => `${i ? "L" : "M"}${g.X(i / 80).toFixed(1)},${g.Y(truthY(truth, i / 80)).toFixed(1)}`).join("");

function regionLabels(g) {
  return [
    svg("text", { x: g.m.l + g.pw / 2, y: g.m.t + 16, class: "db-region-label", "text-anchor": "middle" }, "▲ predict: fails"),
    svg("text", { x: g.m.l + g.pw / 2, y: g.m.t + g.ph - 8, class: "db-region-label", "text-anchor": "middle" }, "● predict: healthy"),
  ];
}

let clipCount = 0;
function clipFor(g) {
  const id = `db-clip-${++clipCount}`;
  return { id, def: svg("defs", {}, svg("clipPath", { id }, svg("rect", { x: g.m.l, y: g.m.t, width: g.pw, height: g.ph }))) };
}

function metric(label, value, state) {
  return h("div", { class: "g-metric", dataset: state ? { state } : {} }, h("span", { class: "g-metric-label" }, label), h("span", { class: "g-metric-value" }, value));
}

/** A small legend entry: an inline SVG swatch plus text. */
function key(kind, text) {
  const s = { viewBox: "0 0 26 14", class: "db-key", "aria-hidden": "true" };
  const line = (cls) => svg("svg", s, svg("line", { x1: 1, x2: 25, y1: 7, y2: 7, class: cls }));
  const swatch = {
    healthy: () => svg("svg", s, svg("circle", { cx: 13, cy: 7, r: 4.8, class: "db-pt is-healthy is-train" })),
    fails: () => svg("svg", s, svg("path", { d: triangle(13, 7.5, 4.8), class: "db-pt is-fails is-train" })),
    test: () => svg("svg", s, svg("circle", { cx: 8, cy: 7, r: 3, class: "db-pt is-healthy is-test" }), svg("path", { d: triangle(19, 7.5, 3), class: "db-pt is-fails is-test" })),
    wrong: () => svg("svg", s, svg("circle", { cx: 13, cy: 7, r: 6, class: "db-wrong" })),
    flipped: () => svg("svg", s, svg("circle", { cx: 13, cy: 7, r: 6, class: "db-flipped" })),
    you: () => line("db-boundary"),
    old: () => line("db-boundary is-old"),
    fitted: () => line("db-fitted"),
    truth: () => line("db-truth"),
    region: () => svg("svg", s, svg("rect", { x: 1, y: 1, width: 24, height: 12, class: "db-region" })),
  }[kind]();
  return h("span", { class: "db-key-item" }, swatch, text);
}

function onResize(ctx, fn) {
  let timer = null;
  let lastWidth = window.innerWidth;
  const handler = () => {
    if (window.innerWidth === lastWidth) return;
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

// ---------------------------------------------------------------- drawing levels

function playDraw(ctx, round) {
  const level = ctx.level;
  const two = level.mode === "two";
  let phase = 0; // level 5: 0 = small training set, 1 = full training set
  let ctrl = straightBoundary(0.5, 0.5);
  let lockedA = null; // level 5: boundary drawn on the small set
  let selected = -1;
  let g = null;
  let parts = null; // live SVG elements updated while dragging
  const visible = () => (two && phase === 0 ? round.train.slice(0, level.nSmall) : round.train);

  const plot = h("div", { class: "db-plot" });
  const metrics = h("div", { class: "g-metrics db-metrics" });
  const addBtn = h("button", { type: "button", class: "g-btn", onclick: addInGap }, "Add bend");
  const removeBtn = h("button", { type: "button", class: "g-btn", onclick: () => remove(selected) }, "Remove bend");
  const straightBtn = h("button", { type: "button", class: "g-btn", onclick: straighten }, "Straighten");
  const submitBtn = h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: submit });
  const note = h("div", { class: "db-note", role: "status" });

  function brief() {
    const n = visible().length;
    ctx.setStatus(
      h(
        "p",
        { class: "db-brief" },
        two
          ? phase === 0
            ? `Step 1 of 2: you only have ${n} maintenance records so far. Draw your best boundary. `
            : `Step 2 of 2: ${round.train.length - level.nSmall} more records arrived, ${n} in all. Redraw the boundary. `
          : `${n} maintenance records. `,
        noiseText(level.noise),
        ` ${round.test.length} more machines are held back as a test set.`,
      ),
    );
    submitBtn.textContent = two ? (phase === 0 ? "Lock in boundary A" : "Test both boundaries") : "Test my boundary";
  }

  /** Update everything that depends on the boundary, without rebuilding the SVG. */
  function update() {
    const train = visible();
    const predict = boundaryPredictor(ctrl);
    const err = errorOf(train, predict);
    parts.region.setAttribute("points", regionPoints(g, ctrl));
    parts.line.setAttribute("d", boundaryPath(g, ctrl));
    replace(parts.wrong, train.filter((p) => predict(p) !== p.label).map((p) => svg("circle", { cx: g.X(p.x), cy: g.Y(p.y), r: 9, class: "db-wrong" })));
    parts.handles.forEach((el, i) => {
      el.setAttribute("transform", `translate(${g.X(ctrl[i].x).toFixed(1)},${g.Y(ctrl[i].y).toFixed(1)})`);
      el.setAttribute("aria-valuenow", fmt(toUnit(AXES.y, ctrl[i].y), 0));
      el.setAttribute("aria-valuetext", inUnits(ctrl[i]));
      el.classList.toggle("is-selected", i === selected);
    });
    parts.root.setAttribute("aria-label", `Machines by vibration and temperature with your boundary. Training error ${share(err)}.`);
    replace(
      metrics,
      metric("Training error", `${err.wrong} of ${err.n}`, err.wrong === 0 ? "good" : null),
      metric("As a share", pct(err.rate, 1)),
      metric("Bends", `${bends(ctrl)} of ${MAX_BENDS}`),
    );
    removeBtn.disabled = !(selected > 0 && selected < ctrl.length - 1);
    addBtn.disabled = bends(ctrl) >= MAX_BENDS;
    straightBtn.disabled = bends(ctrl) === 0;
    return err;
  }

  function toPlot(e) {
    const rect = parts.root.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * g.W;
    const py = ((e.clientY - rect.top) / rect.height) * g.H;
    return { x: (px - g.m.l) / g.pw, y: 1 - (py - g.m.t) / g.ph };
  }

  function handle(i) {
    const anchor = i === 0 || i === ctrl.length - 1;
    const el = svg(
      "g",
      {
        class: `db-handle${anchor ? " is-anchor" : ""}`,
        tabindex: "0",
        role: "slider",
        "aria-orientation": "vertical",
        "aria-valuemin": AXES.y.min,
        "aria-valuemax": AXES.y.max,
        "aria-label": anchor ? `${i === 0 ? "Left" : "Right"} end of the boundary` : `Bend ${i} of ${ctrl.length - 2}`,
      },
      svg("circle", { r: 17, class: "db-handle-hit" }),
      svg("circle", { r: anchor ? 8 : 7, class: "db-handle-dot" }),
    );
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      selected = i;
      el.setPointerCapture(e.pointerId);
      el.focus({ preventScroll: true });
      update();
      const move = (ev) => {
        const p = toPlot(ev);
        ctrl = moveControl(ctrl, i, p.x, p.y);
        update();
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        ctx.announce(`Training error ${share(errorOf(visible(), boundaryPredictor(ctrl)))}.`);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
    // Keep the page from scrolling while a handle is dragged on a touch screen.
    el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    el.addEventListener("click", (e) => e.stopPropagation()); // a click on a handle must not add a bend
    el.addEventListener("focus", () => {
      selected = i;
      update();
    });
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      const d = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key];
      if (d) {
        e.preventDefault();
        ctrl = moveControl(ctrl, i, ctrl[i].x + d[0], ctrl[i].y + d[1]);
        update();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove(i);
      }
    });
    return el;
  }

  /** Rebuild the whole SVG (new width, new points, or a different number of handles). */
  function build(focusIndex = -1) {
    g = geometry(chartWidth(plot));
    const clip = clipFor(g);
    const region = svg("polygon", { class: "db-region" });
    const line = svg("path", { class: "db-boundary" });
    const wrong = svg("g", {});
    const handles = ctrl.map((_, i) => handle(i));
    const root = svg(
      "svg",
      { viewBox: `0 0 ${g.W} ${g.H}`, class: "db-svg is-live", role: "group" },
      clip.def,
      axesLayer(g),
      svg("g", { "clip-path": `url(#${clip.id})` }, region, lockedA ? svg("path", { d: boundaryPath(g, lockedA), class: "db-boundary is-old" }) : null),
      regionLabels(g),
      visible().map((p) => machine(g, p)),
      wrong,
      svg("g", { "clip-path": `url(#${clip.id})` }, line),
      handles,
    );
    root.addEventListener("click", (e) => {
      const p = toPlot(e);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
      const res = addBend(ctrl, p.x, p.y);
      if (res.index < 0) return;
      ctrl = res.ctrl;
      selected = res.index;
      build(res.index);
    });
    parts = { root, region, line, wrong, handles };
    replace(plot, root);
    update();
    if (focusIndex >= 0) handles[focusIndex]?.focus({ preventScroll: true });
  }

  function addInGap() {
    const res = addBendInWidestGap(ctrl);
    if (res.index < 0) return;
    ctrl = res.ctrl;
    selected = res.index;
    build(res.index);
    ctx.announce(`Bend added at ${inUnits(ctrl[res.index])}. Use the arrow keys to move it.`);
  }

  function remove(i) {
    if (!(i > 0 && i < ctrl.length - 1)) return;
    ctrl = removeBend(ctrl, i);
    selected = Math.min(i, ctrl.length - 1);
    build(selected);
    ctx.announce("Bend removed.");
  }

  function straighten() {
    ctrl = straightBoundary(ctrl[0].y, ctrl[ctrl.length - 1].y);
    selected = -1;
    build();
    ctx.announce("Boundary straightened.");
  }

  function submit() {
    if (two && phase === 0) {
      lockedA = ctrl.map((c) => ({ ...c }));
      phase = 1;
      selected = -1;
      brief();
      build();
      replace(
        note,
        h(
          "p",
          { class: "db-flash" },
          h("b", {}, "Boundary A is locked "),
          `(the thin dashed line). Now you can see all ${round.train.length} records. Adjust the boundary, then test both.`,
        ),
      );
      ctx.announce(`Boundary A is locked. ${round.train.length} records are now shown.`);
      return;
    }
    if (two) finishTwo(ctx, round, lockedA, ctrl);
    else finishDraw(ctx, round, ctrl);
  }

  onResize(ctx, () => build());
  replace(
    ctx.stage,
    h(
      "div",
      { class: "g-card db-card" },
      h("p", { class: "db-legend" }, key("healthy", "stayed healthy"), key("fails", "failed within a month"), key("wrong", "on the wrong side of your boundary"), key("region", "you predict a failure here")),
      plot,
      metrics,
      h("div", { class: "db-controls" }, addBtn, removeBtn, straightBtn),
      note,
      h("div", { class: "g-actions" }, submitBtn),
    ),
  );
  brief();
  build();
}

/** The results figure: training and test machines with every boundary drawn in. */
function resultPlot(round, o) {
  const g = geometry(o.width);
  const clip = clipFor(g);
  const lines = [];
  if (o.old) lines.push(svg("path", { d: boundaryPath(g, o.old), class: "db-boundary is-old" }));
  if (o.fitted) lines.push(svg("path", { d: contourPath(g, (p) => logisticScore(o.fitted, p)), class: "db-fitted" }));
  lines.push(svg("path", { d: truthPath(g, round.truth), class: "db-truth" }));
  lines.push(svg("path", { d: boundaryPath(g, o.ctrl), class: "db-boundary" }));
  return svg(
    "svg",
    { viewBox: `0 0 ${g.W} ${g.H}`, class: "db-svg", role: "img", "aria-label": o.label },
    clip.def,
    axesLayer(g),
    svg("g", { "clip-path": `url(#${clip.id})` }, svg("polygon", { points: regionPoints(g, o.ctrl), class: "db-region" })),
    round.test.map((p) => machine(g, p, "test")),
    o.train.map((p) => machine(g, p)),
    o.train.filter((p) => p.flipped).map((p) => svg("circle", { cx: g.X(p.x), cy: g.Y(p.y), r: 9, class: "db-flipped" })),
    svg("g", { "clip-path": `url(#${clip.id})` }, lines),
  );
}

const shapeName = (model) => (model.degree === 2 ? "gentle curve" : "straight line");
const truthName = (truth) => (truth.kind === "line" ? "a straight line" : "a curve");
const figureWidth = () => chartWidth(document.querySelector(".g-screen"), 640) - 24;
const verdict = (stars) => ({ outcome: stars === 3 ? "win" : stars === 0 ? "miss" : "ok", stars });

function holdOutSection(round, you) {
  return {
    title: "Why we hold out test data",
    body: `<p>The ${round.test.length} test machines came from the same process but were never used for drawing. Only they can tell you how the boundary will do on <b>new</b> machines, which is what a maintenance team cares about.</p><p>${
      round.noise
        ? `Because about ${Math.round(round.noise * 100)}% of labels are wrong, even the true rule gets some test labels “wrong”. That floor is the best any boundary can do. Yours was ${points(Math.max(0, you.test.rate - round.noise))} above it.`
        : "With no label noise, a boundary in the right place can reach 0% test error."
    } If you kept adjusting the boundary after seeing the test result, the test set would turn into training data and stop being an honest check.</p>`,
  };
}

function finishDraw(ctx, round, ctrl) {
  const level = ctx.level;
  const you = evaluateBoundary(ctrl, round.train, round.test);
  const ref = referenceModels(round.train, round.test, round.truth);
  const stars = starsFor(you.test.rate, ref.fitted.test.rate);
  const gap = you.test.rate - you.train.rate;
  const flipped = round.train.filter((p) => p.flipped).length;
  const cols = [you, ref.fitted, ref.memorizer, ref.truth];

  const figure = h(
    "div",
    { class: "g-card db-card" },
    resultPlot(round, {
      width: figureWidth(),
      ctrl,
      train: round.train,
      fitted: ref.model,
      label: `Training and test machines with your boundary, the fitted model, and the true rule. Your test error is ${pct(you.test.rate, 1)}.`,
    }),
    h(
      "p",
      { class: "db-legend" },
      key("healthy", "healthy"),
      key("fails", "failed"),
      key("test", "test machines (small, hollow)"),
      flipped ? key("flipped", "training record with a wrong label") : null,
      key("you", "your boundary"),
      key("fitted", "fitted model"),
      key("truth", "true rule"),
    ),
  );

  const debrief = [
    {
      title: "Training error and test error",
      body: `<p><b>Training error</b> is the share of mistakes on the data you could see: ${share(you.train)}. <b>Test error</b> is the share of mistakes on data you could not see: ${share(you.test)}.</p><p class="g-formula">gap = test error − training error = ${pct(you.test.rate, 1)} − ${pct(you.train.rate, 1)} = ${points(gap)}</p><p>${
        gap > 0.05
          ? "A gap this large means part of what your boundary learned was true only of these particular training machines."
          : "A small gap means your boundary learned something that carries over to new machines."
      }</p>`,
    },
    {
      title: "Overfitting: learning the noise",
      body: `<p>${
        flipped
          ? `${plural(flipped, "training record")} had the wrong label (ringed with dots in the figure). A boundary that bends to fit them is learning mistakes, and it will repeat them on new machines.`
          : level.noise
            ? "By chance, none of this round's training records had a wrong label, so there was no noise to learn. When there is, a boundary that bends around single points learns the mistakes."
            : "This level had no wrong labels, so there was no noise to learn. On the noisy levels, a boundary that bends around single points learns the mistakes."
      } You used ${plural(you.bends, "bend")}.</p><p>The <b>memorizer</b> is the extreme case. It copies the label of the nearest training machine, so its training error is ${pct(ref.memorizer.train.rate, 0)}. On the test set it gets ${pct(ref.memorizer.test.rate, 1)} wrong, against ${pct(ref.fitted.test.rate, 1)} for the fitted ${shapeName(ref.model)}. A perfect score on the training data is not the goal.</p>`,
    },
  ];
  if (round.truth.kind === "valley") {
    const straight = errorOf(round.test, logisticPredictor(fitLogistic(round.train, 1)));
    debrief.push({
      title: "Too simple also fails: underfitting",
      body: `<p>Here the true rule is a curve: machines in a middle band of vibration fail at lower temperatures (a resonance). The best <b>straight</b> line the computer can fit still gets ${pct(straight.rate, 1)} of test machines wrong. A model that is too simple misses a real pattern, and that is called <b>underfitting</b>. A few bends help. Many bends overfit. The skill is finding the middle.</p>`,
    });
  }
  debrief.push(holdOutSection(round, you));

  ctx.finish({
    ...verdict(stars),
    headline: `Your boundary gets ${pct(you.test.rate, 1)} of new machines wrong`,
    summary: `On the ${round.train.length} machines you could see, your boundary made ${plural(you.train.wrong, "mistake")} (${pct(you.train.rate, 1)}). On ${round.test.length} new machines it made ${you.test.wrong} (${pct(you.test.rate, 1)}). The computer's fitted model, a ${shapeName(ref.model)}, got ${pct(ref.fitted.test.rate, 1)} of the test machines wrong${
      you.test.rate <= ref.fitted.test.rate ? ", so you matched or beat it." : "."
    } ${level.noise ? `The true rule itself disagrees with ${pct(ref.truth.test.rate, 1)} of the test labels, because of label noise.` : ""}`,
    comparison: {
      caption: "Errors are the share of machines misclassified. Lower is better.",
      columns: ["You", "Fitted model", "Memorizer", "True rule"],
      rows: [
        { label: "Training error", values: cols.map((c) => pct(c.train.rate, 1)) },
        { label: "Test error", values: cols.map((c) => pct(c.test.rate, 1)) },
        { label: "Gap (test − training)", values: cols.map((c) => `${fmt(100 * (c.test.rate - c.train.rate), 1)} pts`) },
        { label: "Shape", values: [plural(you.bends, "bend"), shapeName(ref.model), "copies nearest", truthName(round.truth).replace(/^a /, "")] },
      ],
    },
    figure,
    debrief,
  });
}

function finishTwo(ctx, round, ctrlA, ctrlB) {
  const level = ctx.level;
  const small = round.train.slice(0, level.nSmall);
  const a = evaluateBoundary(ctrlA, small, round.test);
  const b = evaluateBoundary(ctrlB, round.train, round.test);
  const refA = referenceModels(small, round.test, round.truth);
  const refB = referenceModels(round.train, round.test, round.truth);
  const stars = starsFor(b.test.rate, refB.fitted.test.rate);
  const better = a.test.rate - b.test.rate;

  const figure = h(
    "div",
    { class: "g-card db-card" },
    resultPlot(round, {
      width: figureWidth(),
      ctrl: ctrlB,
      old: ctrlA,
      train: round.train,
      fitted: refB.model,
      label: `All training and test machines with boundary A, boundary B, the fitted model, and the true rule. Boundary B's test error is ${pct(b.test.rate, 1)}.`,
    }),
    h(
      "p",
      { class: "db-legend" },
      key("healthy", "healthy"),
      key("fails", "failed"),
      key("test", "test machines (small, hollow)"),
      key("old", `boundary A (${level.nSmall} records)`),
      key("you", `boundary B (${round.train.length} records)`),
      key("fitted", "fitted model"),
      key("truth", "true rule"),
    ),
  );

  ctx.finish({
    ...verdict(stars),
    headline:
      better > 0.005
        ? `More data cut your test error from ${pct(a.test.rate, 1)} to ${pct(b.test.rate, 1)}`
        : `Test error: ${pct(a.test.rate, 1)} with ${level.nSmall} records, ${pct(b.test.rate, 1)} with ${round.train.length}`,
    summary: `Boundary A was drawn from ${level.nSmall} records and boundary B from ${round.train.length}. Both were then tested on the same ${round.test.length} unseen machines. The computer's fitted model went from ${pct(refA.fitted.test.rate, 1)} to ${pct(refB.fitted.test.rate, 1)} with the extra data. The true rule disagrees with ${pct(refB.truth.test.rate, 1)} of the test labels, because of label noise.`,
    comparison: {
      caption: "The same test set for every column. Lower is better.",
      columns: [`You, ${level.nSmall} records`, `You, ${round.train.length} records`, `Fitted, ${level.nSmall}`, `Fitted, ${round.train.length}`],
      rows: [
        { label: "Training error", values: [a, b, refA.fitted, refB.fitted].map((c) => pct(c.train.rate, 1)) },
        { label: "Test error", values: [a, b, refA.fitted, refB.fitted].map((c) => pct(c.test.rate, 1)) },
        { label: "Shape", values: [plural(a.bends, "bend"), plural(b.bends, "bend"), shapeName(refA.model), shapeName(refB.model)] },
      ],
    },
    figure,
    debrief: [
      {
        title: "Small training sets fool you",
        body: `<p>With ${level.nSmall} records, your boundary A had a training error of ${pct(a.train.rate, 1)} and a test error of ${pct(a.test.rate, 1)}. A handful of points can be separated in many ways, and most of them are wrong about the machines you haven't seen. A low training error on a small set says very little.</p><p>The true rule here is a curve. With ${level.nSmall} points there is no way to see it. With ${round.train.length} the shape shows up.</p>`,
      },
      {
        title: "More data narrows the gap",
        body: `<p class="g-formula">gap A = ${pct(a.test.rate, 1)} − ${pct(a.train.rate, 1)} = ${points(a.test.rate - a.train.rate)};  gap B = ${pct(b.test.rate, 1)} − ${pct(b.train.rate, 1)} = ${points(b.test.rate - b.train.rate)}</p><p>With more records, training error becomes a more honest guide to test error, and a more flexible boundary becomes safe to use. This is why plants that log every machine, every shift, can use machine learning at all.</p>`,
      },
      holdOutSection(round, b),
    ],
  });
}

// ---------------------------------------------------------------- complexity slider (level 6)

const GRID = { cols: 48, rows: 36 };

/** Chart of error against model complexity. series: [{ key, name, cls, marker }]. */
function errorChart(curve, o) {
  const W = o.width;
  const H = o.small ? 170 : 270;
  const m = { l: 44, r: 14, t: o.small ? 14 : 30, b: 44 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const top = Math.max(0.1, Math.ceil(Math.max(...curve.flatMap((c) => o.series.map((s) => c[s.key]))) * 10) / 10);
  const X = (i) => m.l + (i / (curve.length - 1)) * pw;
  const Y = (v) => m.t + (1 - v / top) * ph;
  const els = [];
  for (let v = 0; v <= top + 1e-9; v += top > 0.3 ? 0.1 : 0.05) {
    els.push(svg("line", { x1: m.l, x2: m.l + pw, y1: Y(v), y2: Y(v), class: "db-grid" }));
    els.push(svg("text", { x: m.l - 6, y: Y(v) + 4, class: "db-tick", "text-anchor": "end" }, `${Math.round(v * 100)}%`));
  }
  curve.forEach((c, i) => els.push(svg("text", { x: X(i), y: m.t + ph + 15, class: "db-tick", "text-anchor": "middle" }, String(c.k))));
  els.push(svg("text", { x: m.l + pw / 2, y: H - 8, class: "db-axis-title", "text-anchor": "middle" }, "simple  ←  neighbors k  →  complex"));
  (o.marks || []).forEach((mk) => {
    els.push(svg("line", { x1: X(mk.index), x2: X(mk.index), y1: m.t - 4, y2: m.t + ph, class: `db-pick-line ${mk.cls || ""}` }));
    els.push(svg("text", { x: X(mk.index), y: m.t - 8 - (mk.row || 0) * 12, class: "db-pick-label", "text-anchor": mk.index === 0 ? "start" : mk.index === curve.length - 1 ? "end" : "middle" }, mk.text));
  });
  o.series.forEach((s) => {
    const shown = curve.map((c, i) => ({ i, v: c[s.key] })).filter((p) => !o.visited || o.visited.has(p.i));
    if (!o.visited) els.push(svg("path", { d: shown.map((p, n) => `${n ? "L" : "M"}${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(""), class: `db-series ${s.cls}` }));
    shown.forEach((p) => {
      const cx = X(p.i);
      const cy = Y(p.v);
      const cls = `db-series-pt ${s.cls}${o.current === p.i ? " is-current" : ""}`;
      if (s.marker === "square") els.push(svg("rect", { x: cx - 4, y: cy - 4, width: 8, height: 8, class: cls }));
      else if (s.marker === "triangle") els.push(svg("path", { d: triangle(cx, cy, 5), class: cls }));
      else els.push(svg("circle", { cx, cy, r: o.current === p.i ? 6 : 4.2, class: cls }));
    });
  });
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "db-svg", role: "img", "aria-label": o.label }, els);
}

const SERIES = {
  train: { key: "train", name: "training error", cls: "is-train", marker: "circle" },
  val: { key: "val", name: "validation error", cls: "is-val", marker: "square" },
  test: { key: "test", name: "test error", cls: "is-test", marker: "triangle" },
};

function playSlider(ctx, round) {
  const level = ctx.level;
  const curve = knnCurve(round);
  const cells = [];
  for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) cells.push({ x: (c + 0.5) / GRID.cols, y: (r + 0.5) / GRID.rows });
  const grid = knnPredictAll(round.train, cells, KS);
  const trainPred = knnPredictAll(round.train, round.train, KS);
  const visited = new Set([0]);
  let index = 0;

  const plot = h("div", { class: "db-plot" });
  const mini = h("div", { class: "db-mini" });
  const metrics = h("div", { class: "g-metrics db-metrics" });
  const out = h("output", { class: "db-k", for: "db-complexity" });
  const slider = h("input", { type: "range", id: "db-complexity", class: "db-slider", min: "0", max: String(KS.length - 1), step: "1", value: "0" });

  function regions(g, k) {
    const rects = [];
    const cw = g.pw / GRID.cols;
    const chh = g.ph / GRID.rows;
    for (let r = 0; r < GRID.rows; r++) {
      let start = -1;
      for (let c = 0; c <= GRID.cols; c++) {
        const on = c < GRID.cols && grid[k][r * GRID.cols + c] === 1;
        if (on && start < 0) start = c;
        if (!on && start >= 0) {
          rects.push(svg("rect", { x: g.m.l + start * cw, y: g.Y((r + 1) / GRID.rows), width: (c - start) * cw + 0.3, height: chh + 0.3, class: "db-region" }));
          start = -1;
        }
      }
    }
    return rects;
  }

  function draw() {
    const k = KS[index];
    const g = geometry(chartWidth(plot));
    const wrong = round.train.filter((p, i) => trainPred[k][i] !== p.label);
    const err = curve[index].train;
    replace(
      plot,
      svg(
        "svg",
        { viewBox: `0 0 ${g.W} ${g.H}`, class: "db-svg", role: "img", "aria-label": `Decision regions of a ${k}-nearest-neighbor model on ${round.train.length} training machines. Training error ${pct(err, 1)}.` },
        axesLayer(g),
        regions(g, k),
        round.train.map((p) => machine(g, p)),
        wrong.map((p) => svg("circle", { cx: g.X(p.x), cy: g.Y(p.y), r: 9, class: "db-wrong" })),
      ),
    );
    replace(
      mini,
      h("p", { class: "db-mini-title" }, "Training error at the settings you have tried"),
      errorChart(curve, { width: Math.min(460, chartWidth(mini)), small: true, series: [SERIES.train], visited, current: index, label: `Training error for the ${visited.size} settings tried so far. Current: ${pct(err, 1)} at k = ${k}.` }),
    );
    replace(metrics, metric("Neighbors k", String(k)), metric("Training error", `${wrong.length} of ${round.train.length}`, wrong.length === 0 ? "good" : null), metric("As a share", pct(err, 1)));
    out.textContent = `k = ${k}`;
    slider.setAttribute("aria-valuetext", `k = ${k}, training error ${pct(err, 1)}`);
  }

  slider.addEventListener("input", () => {
    index = Number(slider.value);
    visited.add(index);
    draw();
  });
  onResize(ctx, draw);

  ctx.setStatus(
    h(
      "p",
      { class: "db-brief" },
      `This time the computer draws the boundary from ${round.train.length} maintenance records. A new machine gets the majority label of its k nearest neighbors on the plot. `,
      noiseText(level.noise),
      " A small k follows every single point (complex). A large k smooths them out (simple). Which setting would you ship?",
    ),
  );
  replace(
    ctx.stage,
    h(
      "div",
      { class: "g-card db-card" },
      h("p", { class: "db-legend" }, key("healthy", "stayed healthy"), key("fails", "failed within a month"), key("wrong", "model gets this one wrong"), key("region", "model predicts a failure here")),
      plot,
      h(
        "div",
        { class: "db-complexity" },
        h("div", { class: "db-complexity-head" }, h("label", { for: "db-complexity" }, "Model complexity"), out),
        slider,
        h("div", { class: "db-scale", "aria-hidden": "true" }, h("span", {}, `simple (k = ${KS[0]})`), h("span", {}, `complex (k = ${KS[KS.length - 1]})`)),
      ),
      metrics,
      mini,
      h("div", { class: "g-actions" }, h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: () => finishSlider(ctx, round, curve, index) }, "Ship this model")),
    ),
  );
  draw();
}

function finishSlider(ctx, round, curve, pick) {
  const byVal = bestIndex(curve, "val");
  const byTest = bestIndex(curve, "test");
  const memo = curve.length - 1;
  const you = curve[pick];
  const stars = starsFor(you.test, curve[byVal].test);
  const cols = [pick, byVal, byTest, memo].map((i) => curve[i]);
  const marks = pick === byVal ? [{ index: pick, text: "your pick = validation pick" }] : [{ index: pick, text: "your pick" }, { index: byVal, text: "validation pick", cls: "is-alt", row: Math.abs(pick - byVal) < 3 ? 1 : 0 }];

  const figure = h(
    "div",
    { class: "g-card db-card" },
    h("h2", { class: "db-title" }, "Error against model complexity"),
    errorChart(curve, {
      width: Math.min(620, figureWidth()),
      series: [SERIES.train, SERIES.val, SERIES.test],
      marks,
      label: `Training, validation, and test error for k from ${KS[0]} to ${KS[KS.length - 1]}. Test error is lowest at k = ${curve[byTest].k}.`,
    }),
    h(
      "p",
      { class: "db-legend" },
      Object.values(SERIES).map((s) =>
        h(
          "span",
          { class: "db-key-item" },
          svg(
            "svg",
            { viewBox: "0 0 26 14", class: "db-key", "aria-hidden": "true" },
            svg("line", { x1: 1, x2: 25, y1: 7, y2: 7, class: `db-series ${s.cls}` }),
            s.marker === "square"
              ? svg("rect", { x: 9, y: 3, width: 8, height: 8, class: `db-series-pt ${s.cls}` })
              : s.marker === "triangle"
                ? svg("path", { d: triangle(13, 7.5, 5), class: `db-series-pt ${s.cls}` })
                : svg("circle", { cx: 13, cy: 7, r: 4.2, class: `db-series-pt ${s.cls}` }),
          ),
          s.name,
        ),
      ),
    ),
  );

  const side = pick > byTest ? "more complex than" : pick < byTest ? "simpler than" : "the same as";
  ctx.finish({
    ...verdict(stars),
    headline: `Your model (k = ${you.k}) gets ${pct(you.test, 1)} of new machines wrong`,
    summary: `You shipped k = ${you.k}, with a training error of ${pct(you.train, 1)}. On ${round.test.length} unseen machines its error was ${pct(you.test, 1)}. Choosing k with the validation set gives k = ${curve[byVal].k} and a test error of ${pct(curve[byVal].test, 1)}. Your choice was ${side} the best setting in hindsight (k = ${curve[byTest].k}).`,
    comparison: {
      caption: "The same k-nearest-neighbor model at four settings. Lower error is better.",
      columns: ["Your pick", "Validation pick", "Hindsight best", "Memorizer"],
      rows: [
        { label: "k", values: cols.map((c) => String(c.k)) },
        { label: "Training error", values: cols.map((c) => pct(c.train, 1)) },
        { label: "Validation error", values: cols.map((c) => pct(c.val, 1)) },
        { label: "Test error", values: cols.map((c) => pct(c.test, 1)) },
      ],
    },
    figure,
    debrief: [
      {
        title: "The U-shaped test error",
        body: `<p>Read the chart from left to right. At k = ${curve[0].k} the model is too simple: it barely looks at where a machine sits, and gets ${pct(curve[0].test, 1)} of test machines wrong (<b>underfitting</b>). In the middle, at k = ${curve[byTest].k}, test error bottoms out at ${pct(curve[byTest].test, 1)}. At k = 1 the model copies its single nearest neighbor, wrong labels included, and test error climbs back to ${pct(curve[memo].test, 1)} (<b>overfitting</b>).</p>`,
      },
      {
        title: "Training error can't choose the model",
        body: `<p>Training error only goes down as the model gets more complex: from ${pct(curve[0].train, 1)} at k = ${curve[0].k} to ${pct(curve[memo].train, 1)} at k = 1. If you chose by training error you would always pick the memorizer. It looks perfect on the data it has seen and is ${points(curve[memo].test - curve[byTest].test)} worse than the best setting on data it hasn't.</p>`,
      },
      {
        title: "Validate to choose, test once to report",
        body: `<p>The fix is to hold data out. Here ${round.val.length} labeled machines were kept aside as a <b>validation set</b>. Picking the k with the lowest validation error gives k = ${curve[byVal].k}, which lands ${
          byVal === byTest ? "exactly on" : `within ${points(curve[byVal].test - curve[byTest].test)} of`
        } the best setting. The <b>test set</b> is then used once, at the very end, to report how good the chosen model really is. It can't also be used for choosing, or the reported error would be too rosy.</p>`,
      },
    ],
  });
}

// Created last, so every helper above exists even when ?autostart=1 starts a round right away.
createGame({
  slug: "draw-the-boundary",
  title: "Draw the Boundary",
  tagline: "Split the machines that failed from the ones that didn't. Then meet the machines you haven't seen.",
  objective: "tell training error from test error, spot overfitting, and explain why a model must be judged on data it has never seen.",
  minutes: "10-20",
  chapter: { href: "../../chapters/week-15.html", label: "Week 15 · Ethics, Sustainability, and the Future of IME" },
  howToPlay: [
    "Each point is one machine from last year's maintenance records, placed by its vibration and bearing temperature. A circle stayed healthy; a triangle failed within a month.",
    "Draw the <b>boundary</b>: above it you predict a failure, below it a healthy machine. Drag the two end handles, and tap the plot (or press <b>Add bend</b>) to add a bend you can drag.",
    "Your <b>training error</b> updates as you draw. When you are happy, test the boundary on new machines from the same plant that you have never seen.",
    "Keyboard: <kbd>Tab</kbd> to a handle, arrow keys to move it (<kbd>Shift</kbd> for bigger steps), <kbd>Delete</kbd> to remove a bend.",
    "Level 6 is different: the computer fits the model, and you choose how complex it should be.",
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start(ctx) {
    const round = generateRound(ctx.rng, ctx.level);
    if (ctx.level.mode === "slider") playSlider(ctx, round);
    else playDraw(ctx, round);
  },
});
