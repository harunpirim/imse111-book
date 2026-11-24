// Corner Hunter: drag a production plan around the feasible region of a
// two-product linear program and hunt for the most profitable corner.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt, pct } from "../shared/dom.js";
import {
  ASSUMPTIONS,
  LEVELS,
  STAR_SHARES,
  generateProblem,
  check,
  solve,
  profitAt,
  greedyPlan,
  valueOfOneMore,
  bestWithout,
  parallelConstraint,
  snapPoint,
  starsFor,
  formula,
} from "./logic.js";

// Each limit has a palette color, a line pattern, and a number tag, so limits
// can be told apart without color.
const DASH = [null, "9 5", "3 4", "12 4 3 4"];
const conColor = (i) => `var(--c${[1, 6, 3, 4][i % 4]})`;
const num = (v) => String(Math.round(v * 100) / 100);
const money = (v) => {
  const r = Math.round(v * 100) / 100;
  return `${r < 0 ? "−" : ""}$${Math.abs(r).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const point = (p) => `(${num(p.x)}, ${num(p.y)})`;

createGame({
  slug: "corner-hunter",
  title: "Corner Hunter",
  tagline: "The best plan is hiding at a corner. Find it.",
  objective:
    "read the feasible region of a two-product linear program, tell binding constraints from ones with slack, and explain why the best plan sits at a corner point.",
  minutes: "10-15",
  chapter: { href: "../../chapters/week-10.html", label: "Week 10 · Modeling, Optimization, and Simulation" },
  howToPlay: [
    "A small shop makes two products. Each <b>limit</b> (hours, material, sales) is a line on the graph, and the shaded <b>feasible region</b> holds every plan that respects all of them.",
    "Drag the dot, or tap the graph, to choose how many of each product to make per week. The dot snaps to edges and corners.",
    "Watch the profit and the list of limits: a limit is <b>binding</b> when it is used up, has <b>slack</b> when some is left, and is <b>violated</b> when the plan needs more than there is.",
    "Turn on the <b>iso-profit line</b> to see every plan that earns the same as yours. Push it as far out as the region allows.",
    "Keyboard: focus the dot and use the arrow keys (hold <kbd>Shift</kbd> for steps of 0.1), or type amounts in the two boxes. <kbd>I</kbd> toggles the iso-profit line.",
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start,
});

function start(ctx) {
  const problem = generateProblem(ctx.rng, ctx.level);
  const { story, profit, constraints } = problem;
  const plan = { x: 0, y: 0 };
  let iso = false;

  ctx.setStatus(
    h(
      "p",
      { class: "ch-brief" },
      h("strong", {}, `${story.shop}: `),
      `each week the shop makes x ${story.x.name} and y ${story.y.name}. `,
      "Profit = ",
      h("span", { class: "g-formula ch-inline" }, `${money(profit[0])}·x + ${money(profit[1])}·y`),
      ". Find the plan with the highest profit that breaks no limit.",
    ),
  );

  const plotHost = h("div", { class: "ch-plot" });
  const profitEl = h("span", { class: "g-metric-value" });
  const profitSub = h("span", { class: "ch-metric-sub" });
  const feasEl = h("span", { class: "g-metric-value" });
  const feasTile = h("div", { class: "g-metric" }, h("span", { class: "g-metric-label" }, "Plan"), feasEl);
  const inputs = {
    x: h("input", { type: "number", id: "ch-x", class: "ch-input", min: 0, max: problem.xMax, step: 0.5, inputmode: "decimal" }),
    y: h("input", { type: "number", id: "ch-y", class: "ch-input", min: 0, max: problem.yMax, step: 0.5, inputmode: "decimal" }),
  };
  const rowEls = constraints.map((c, i) => {
    const used = h("span", { class: "ch-con-used" });
    const state = h("span", { class: "ch-con-state" });
    const fill = h("span", { class: "ch-bar-fill" });
    const li = h(
      "li",
      { class: "ch-con", style: `--k:${conColor(i)}` },
      h("span", { class: "ch-tag", "aria-hidden": "true" }, String(i + 1)),
      h(
        "div",
        { class: "ch-con-main" },
        h("div", { class: "ch-con-head" }, h("strong", {}, `${i + 1}. ${c.name}`), h("span", { class: "ch-con-formula" }, `${formula(c)} ${c.unit}`)),
        h("div", { class: "ch-bar", "aria-hidden": "true" }, fill),
        h("div", { class: "ch-con-foot" }, used, state),
      ),
    );
    return { li, used, state, fill };
  });
  const isoBtn = h("button", { type: "button", class: "g-btn", "aria-pressed": "false", onclick: toggleIso }, "Show iso-profit line");
  const submitBtn = h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: submit }, "Lock in this plan");
  const noteEl = h("p", { class: "ch-problems", role: "note" });

  replace(
    ctx.stage,
    h(
      "div",
      { class: "ch-grid" },
      h(
        "section",
        { class: "g-card ch-plot-card", "aria-label": "Graph of the limits and the feasible region" },
        plotHost,
        h("p", { class: "ch-hint" }, "Drag the dot or tap the graph. The shaded area is the feasible region. Numbers in circles match the limits in the list."),
      ),
      h(
        "section",
        { class: "ch-side", "aria-label": "Your plan and the limits" },
        h(
          "div",
          { class: "ch-plan" },
          h("label", { class: "ch-field", for: "ch-x" }, h("span", { class: "ch-var" }, "x ="), inputs.x, h("span", {}, story.x.name)),
          h("label", { class: "ch-field", for: "ch-y" }, h("span", { class: "ch-var" }, "y ="), inputs.y, h("span", {}, story.y.name)),
        ),
        h(
          "div",
          { class: "g-metrics ch-metrics", "aria-live": "off" },
          h("div", { class: "g-metric ch-profit" }, h("span", { class: "g-metric-label" }, "Profit per week"), profitEl, profitSub),
          feasTile,
        ),
        h("h2", { class: "ch-h" }, "Limits"),
        h("ul", { class: "ch-cons" }, rowEls.map((r) => r.li)),
        h("div", { class: "g-actions ch-actions" }, submitBtn, isoBtn),
        noteEl,
      ),
    ),
  );

  const plot = drawPlot(problem, {
    width: plotWidth(plotHost),
    interactive: true,
    onMove: (x, y, how) => setPlan(x, y, how),
  });
  replace(plotHost, plot.el);

  function setPlan(x, y, how) {
    plan.x = Math.min(problem.xMax, Math.max(0, x));
    plan.y = Math.min(problem.yMax, Math.max(0, y));
    update(how);
  }

  function toggleIso() {
    iso = !iso;
    isoBtn.setAttribute("aria-pressed", String(iso));
    isoBtn.textContent = iso ? "Hide iso-profit line" : "Show iso-profit line";
    update();
    ctx.announce(iso ? `Iso-profit line shown: every plan on it earns ${money(profitAt(problem, plan.x, plan.y))}.` : "Iso-profit line hidden.");
  }

  function update(how) {
    const st = check(problem, plan.x, plan.y);
    if (how !== "input") {
      inputs.x.value = num(plan.x);
      inputs.y.value = num(plan.y);
    }
    profitEl.textContent = money(st.profit);
    profitSub.textContent = `${money(profit[0])} × ${num(plan.x)} + ${money(profit[1])} × ${num(plan.y)}`;
    feasEl.textContent = st.feasible ? "✔ Feasible" : "✖ Not feasible";
    feasTile.dataset.state = st.feasible ? "good" : "bad";

    const words = [];
    st.rows.forEach((r, i) => {
      const c = constraints[i];
      const el = rowEls[i];
      el.li.dataset.state = r.state;
      el.used.textContent = `${num(r.used)} of ${c.rhs} ${c.unit}${c.kind === "resource" ? " used" : ""}`;
      el.fill.style.width = `${Math.min(100, (100 * r.used) / c.rhs)}%`;
      const text = stateText(c, r);
      el.state.textContent = text;
      words.push(`${c.name}: ${text}`);
    });

    submitBtn.disabled = !st.feasible;
    noteEl.className = `ch-problems${st.feasible ? " is-ok" : ""}`;
    noteEl.textContent = st.feasible
      ? st.binding.length
        ? `Feasible. Binding: ${st.binding.map((id) => constraints[id].name).join(", ")}.`
        : "Feasible, with slack in every limit. Could the shop make more?"
      : `To lock in: the plan breaks ${st.violated.map((id) => constraints[id].name).join(", ")}.`;

    plot.update(plan, { iso, feasible: st.feasible, label: `${num(plan.x)} ${story.x.short}, ${num(plan.y)} ${story.y.short}. Profit ${money(st.profit)}. ${st.feasible ? "Feasible" : "Not feasible"}. ${words.join(". ")}.` });
    if (how === "key") ctx.announce(`${num(plan.x)}, ${num(plan.y)}. Profit ${money(st.profit)}. ${st.feasible ? "Feasible" : "Not feasible"}.`);
  }

  for (const axis of ["x", "y"]) {
    inputs[axis].addEventListener("input", () => {
      const v = Number(inputs[axis].value);
      if (inputs[axis].value === "" || !Number.isFinite(v)) return;
      setPlan(axis === "x" ? v : plan.x, axis === "y" ? v : plan.y, "input");
    });
    inputs[axis].addEventListener("change", () => update());
  }

  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if ((e.key === "i" || e.key === "I") && e.target.tagName !== "INPUT") {
      e.preventDefault();
      toggleIso();
    }
  }
  document.addEventListener("keydown", onKey);
  ctx.onCleanup(() => document.removeEventListener("keydown", onKey));

  function submit() {
    const st = check(problem, plan.x, plan.y);
    if (!st.feasible) return;
    showResults(ctx, problem, { ...plan });
  }

  update();
}

/** Words for a limit's state. Icons and words carry the meaning, not color. */
function stateText(c, r) {
  const amount = `${num(Math.abs(r.slack))} ${c.unit}`;
  if (c.kind === "min") {
    if (r.state === "violated") return `✖ Short by ${amount}`;
    return r.state === "binding" ? "● Binding: exactly met" : `○ Slack: ${amount} above the minimum`;
  }
  if (r.state === "violated") return `✖ Violated: over by ${amount}`;
  if (r.state === "binding") return c.kind === "cap" ? "● Binding: at the cap" : "● Binding: all used";
  return `○ Slack: ${amount} left`;
}

function plotWidth(el) {
  const w = el && el.clientWidth ? el.clientWidth : 560;
  return Math.round(Math.min(600, Math.max(280, w)));
}

function niceStep(max) {
  return max <= 12 ? 2 : max <= 30 ? 4 : 10;
}

/**
 * Draw the graph. Returns { el, update(plan, { iso, feasible, label }) }.
 * o.interactive  the dot can be dragged and moved with the keyboard (o.onMove)
 * o.reveal       { sol, you, best } labels every corner with its profit (results screen)
 */
function drawPlot(problem, o = {}) {
  const { story, constraints, xMax, yMax, profit } = problem;
  const W = o.width || 560;
  const H = Math.round(W * 0.82);
  const m = { left: 40, right: 14, top: 26, bottom: 40 };
  const sx = (W - m.left - m.right) / xMax;
  const sy = (H - m.top - m.bottom) / yMax;
  const X = (x) => m.left + x * sx;
  const Y = (y) => H - m.bottom - y * sy;
  const sol = solve(problem);
  const parts = [];

  // Grid and axes
  const stepX = niceStep(xMax);
  const stepY = niceStep(yMax);
  for (let v = 0; v <= xMax; v += stepX) {
    parts.push(svg("line", { x1: X(v), y1: Y(0), x2: X(v), y2: Y(yMax), class: "ch-gridline" }), svg("text", { x: X(v), y: Y(0) + 15, class: "ch-tick ch-tick-x" }, String(v)));
  }
  for (let v = 0; v <= yMax; v += stepY) {
    parts.push(svg("line", { x1: X(0), y1: Y(v), x2: X(xMax), y2: Y(v), class: "ch-gridline" }), svg("text", { x: X(0) - 6, y: Y(v) + 4, class: "ch-tick ch-tick-y" }, String(v)));
  }
  parts.push(
    svg("line", { x1: X(0), y1: Y(0), x2: X(xMax), y2: Y(0), class: "ch-axis" }),
    svg("line", { x1: X(0), y1: Y(0), x2: X(0), y2: Y(yMax), class: "ch-axis" }),
    svg("text", { x: X(xMax), y: H - 6, class: "ch-axis-title ch-axis-title-x" }, `x: ${story.x.name}`),
    svg("text", { x: 4, y: 12, class: "ch-axis-title" }, `y: ${story.y.name}`),
  );

  // Feasible region
  parts.push(svg("polygon", { points: sol.corners.map((c) => `${X(c.x)},${Y(c.y)}`).join(" "), class: "ch-region" }));

  // Limit lines, clipped to the plot box, each with a number tag beside its edge of the region
  constraints.forEach((c, i) => {
    const seg = clipLine(c, xMax, yMax);
    if (!seg) return;
    parts.push(svg("line", { x1: X(seg[0].x), y1: Y(seg[0].y), x2: X(seg[1].x), y2: Y(seg[1].y), class: "ch-line", style: `stroke:${conColor(i)}`, "stroke-dasharray": DASH[i % 4] }));
    const ends = sol.corners.filter((k) => k.on.includes(c.id));
    if (ends.length < 2) return;
    const sign = c.op === "<=" ? 1 : -1;
    let nx = (sign * c.a) / sx;
    let ny = (-sign * c.b) / sy;
    const len = Math.hypot(nx, ny);
    nx /= len;
    ny /= len;
    const tx = (X(ends[0].x) + X(ends[1].x)) / 2 + nx * 15;
    const ty = (Y(ends[0].y) + Y(ends[1].y)) / 2 + ny * 15;
    parts.push(svg("g", { class: "ch-line-tag", transform: `translate(${tx},${ty})` }, svg("circle", { r: 9, style: `stroke:${conColor(i)}` }), svg("text", { dy: "0.35em" }, String(i + 1))));
  });

  // Iso-profit line (moved in update)
  const isoLine = svg("line", { class: "ch-iso", visibility: "hidden" });
  // The label sits under the plot, left of the x-axis title, where it can't cover a line or a tag.
  const isoLabel = svg("text", { class: "ch-iso-label", visibility: "hidden", x: m.left, y: H - 6 });
  parts.push(isoLine, isoLabel);

  function placeIso(z, show) {
    const seg = show ? clipLine({ a: profit[0], b: profit[1], rhs: z }, xMax, yMax) : null;
    const vis = seg ? "visible" : "hidden";
    isoLine.setAttribute("visibility", vis);
    isoLabel.setAttribute("visibility", vis);
    if (!seg) return;
    isoLine.setAttribute("x1", X(seg[0].x));
    isoLine.setAttribute("y1", Y(seg[0].y));
    isoLine.setAttribute("x2", X(seg[1].x));
    isoLine.setAttribute("y2", Y(seg[1].y));
    isoLabel.textContent = `Dotted: profit ${money(z)}`;
  }

  // Results: every corner with its profit, the best one starred
  if (o.reveal) {
    const cx = sol.corners.reduce((s, c) => s + c.x, 0) / sol.corners.length;
    const cy = sol.corners.reduce((s, c) => s + c.y, 0) / sol.corners.length;
    sol.corners.forEach((c) => {
      const isBest = sol.optimal.includes(c);
      let dx = (c.x - cx) * sx;
      let dy = -(c.y - cy) * sy;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      // Corners on the x-axis get their label just above the axis, clear of the tick numbers.
      const onAxis = c.y < 1e-9;
      const lx = onAxis ? X(c.x) + 8 : Math.min(W - 4, Math.max(m.left + 2, X(c.x) + dx * 14));
      const ly = onAxis ? Y(0) - 9 : Y(c.y) + dy * 16 + 4;
      const anchor = onAxis ? (X(c.x) > W - 70 ? "end" : "start") : dx > 0.35 ? (X(c.x) > W - 80 ? "end" : "start") : dx < -0.35 ? "start" : "middle";
      parts.push(
        svg("circle", { cx: X(c.x), cy: Y(c.y), r: isBest ? 7 : 4.5, class: `ch-corner${isBest ? " is-best" : ""}` }),
        svg("text", { x: onAxis && anchor === "end" ? X(c.x) - 8 : lx, y: ly, class: `ch-corner-label${isBest ? " is-best" : ""}`, "text-anchor": anchor }, `${isBest ? "★ " : ""}${money(c.profit)}`),
      );
    });
  }

  // The plan dot
  const handle = svg(
    "g",
    { class: "ch-handle" },
    svg("circle", { r: 22, class: "ch-handle-hit" }),
    svg("circle", { r: 9, class: "ch-handle-dot" }),
    svg("path", { d: "M-4,0 H4 M0,-4 V4", class: "ch-handle-cross" }),
    o.reveal ? svg("text", { class: "ch-you-label", y: -14 }, "You") : null,
  );
  parts.push(handle);

  const el = svg(
    "svg",
    {
      class: `ch-svg${o.interactive ? " is-interactive" : ""}`,
      viewBox: `0 0 ${W} ${H}`,
      role: o.interactive ? "group" : "img",
      "aria-label": o.interactive ? "Graph of the limits and the feasible region" : o.label,
    },
    parts,
  );

  if (o.interactive) {
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", "Production plan. Arrow keys move it; hold Shift for small steps.");
    const toData = (e) => {
      const r = el.getBoundingClientRect();
      const k = W / r.width;
      return { x: ((e.clientX - r.left) * k - m.left) / sx, y: (H - m.bottom - (e.clientY - r.top) * k) / sy };
    };
    const move = (e) => {
      const p = toData(e);
      const s = snapPoint(problem, p.x, p.y, sx, sy);
      o.onMove(s.x, s.y, "drag");
    };
    let dragging = false;
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      dragging = true;
      el.setPointerCapture(e.pointerId);
      handle.focus({ preventScroll: true });
      move(e);
      e.preventDefault();
    });
    el.addEventListener("pointermove", (e) => dragging && move(e));
    const end = () => (dragging = false);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    handle.addEventListener("keydown", (e) => {
      const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 1;
      const cur = handle._plan || { x: 0, y: 0 };
      // Whole steps land on whole numbers, where the corners are.
      const next = (v, dir) => (dir === 0 ? v : step === 1 ? (dir > 0 ? Math.floor(v + 1 + 1e-9) : Math.ceil(v - 1 - 1e-9)) : Math.round((v + dir * step) * 10) / 10);
      o.onMove(next(cur.x, d[0]), next(cur.y, d[1]), "key");
    });
  }

  return {
    el,
    update(plan, s = {}) {
      handle._plan = plan;
      handle.setAttribute("transform", `translate(${X(plan.x)},${Y(plan.y)})`);
      handle.classList.toggle("is-bad", s.feasible === false);
      if (o.interactive) {
        handle.setAttribute("aria-valuenow", String(Math.round(profitAt(problem, plan.x, plan.y))));
        handle.setAttribute("aria-valuetext", s.label || "");
      }
      placeIso(s.isoAt ?? profitAt(problem, plan.x, plan.y), !!s.iso);
    },
  };
}

/** The part of the line a*x + b*y = rhs inside the box [0, xMax] x [0, yMax], or null. */
function clipLine(c, xMax, yMax) {
  const pts = [];
  const add = (x, y) => {
    if (x < -1e-9 || y < -1e-9 || x > xMax + 1e-9 || y > yMax + 1e-9) return;
    if (!pts.some((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9)) pts.push({ x, y });
  };
  if (Math.abs(c.b) > 1e-12) {
    add(0, c.rhs / c.b);
    add(xMax, (c.rhs - c.a * xMax) / c.b);
  }
  if (Math.abs(c.a) > 1e-12) {
    add(c.rhs / c.a, 0);
    add((c.rhs - c.b * yMax) / c.a, yMax);
  }
  return pts.length >= 2 ? [pts[0], pts[1]] : null;
}

function showResults(ctx, problem, you) {
  const { story, constraints, profit } = problem;
  const sol = solve(problem);
  const st = check(problem, you.x, you.y);
  const share = st.profit / sol.best;
  const stars = starsFor(st.profit, sol.best);
  const matched = stars === 3;
  const tie = sol.optimal.length > 1;
  const near = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
  // With a tie, compare against the optimal corner closest to the player's plan.
  const opt = sol.optimal.slice().sort((p, q) => Math.hypot(p.x - you.x, p.y - you.y) - Math.hypot(q.x - you.x, q.y - you.y))[0];
  const optSt = check(problem, opt.x, opt.y);
  const greedy = greedyPlan(problem);
  const gSt = check(problem, greedy.x, greedy.y);
  const atCorner = sol.corners.find((c) => near(c, you));
  const firstName = greedy.first === "x" ? story.x.name : story.y.name;
  const secondName = greedy.first === "x" ? story.y.name : story.x.name;

  const where = matched
    ? tie && !atCorner
      ? "Your plan sits on the winning edge, between two corners that tie for first place."
      : "Your plan is the best corner of the feasible region."
    : atCorner
      ? `You picked a corner, but not the best one. The corner at ${point(opt)} earns ${money(sol.best - st.profit)} more.`
      : st.binding.length
        ? `Your plan sits on an edge of the region. Sliding along that edge toward ${point(opt)} keeps raising profit until you hit the corner.`
        : "Your plan is inside the region, with slack in every limit, so the shop could still make more of both products.";

  const slackLabel = (c) => (c.kind === "min" ? `${c.name}: above the minimum` : c.kind === "cap" ? `${c.name}: room left` : `${c.name}: unused ${c.unit}`);

  // Debrief 1: every corner and its profit
  const ranked = sol.corners.slice().sort((p, q) => q.profit - p.profit);
  const cornerTable = h(
    "div",
    { class: "g-table-wrap" },
    h(
      "table",
      { class: "g-table ch-corner-table" },
      h("caption", {}, `The ${sol.corners.length} corner points of the feasible region, best first`),
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, `Corner (x, y)`), h("th", { scope: "col" }, "Profit"), h("th", { scope: "col" }, ""))),
      h(
        "tbody",
        {},
        ranked.map((c) =>
          h(
            "tr",
            {},
            h("th", { scope: "row" }, point(c)),
            h("td", {}, `${money(profit[0])} × ${num(c.x)} + ${money(profit[1])} × ${num(c.y)} = ${money(c.profit)}`),
            h("td", { class: "ch-corner-note" }, [sol.optimal.includes(c) ? "★ best" : null, near(c, you) ? "your plan" : null].filter(Boolean).join(" · ")),
          ),
        ),
      ),
    ),
  );

  // Debrief 2: binding limits and slack at the optimum
  const marginal = constraints.map((c) => valueOfOneMore(problem, c.id));
  const limitLines = constraints.map((c, i) => {
    const r = optSt.rows[i];
    const v = marginal[i];
    const one = c.unit.replace(/s$/, "");
    if (r.state === "binding") {
      const worth =
        c.kind === "min"
          ? v < -1e-6
            ? `Raising the minimum by one would cost ${money(-v)}.`
            : "Raising the minimum by one would not change the best profit."
          : v > 1e-6
            ? `One more ${c.kind === "cap" ? "sale allowed" : one} would raise the best profit by ${money(v)}.`
            : "One more would not raise the best profit, because another limit stops the plan first.";
      return h("li", {}, h("strong", {}, `${c.name}: binding. `), worth);
    }
    return h("li", {}, h("strong", {}, `${c.name}: slack of ${num(r.slack)} ${c.unit}. `), "More of it is worth $0, because the shop already has some it can't use.");
  });

  const par = parallelConstraint(problem);
  const debrief = [
    {
      title: "The corner point theorem",
      body: h(
        "div",
        {},
        h(
          "p",
          {
            html: `Profit and every limit are straight lines. So as you move across the region in a fixed direction, profit keeps rising or keeps falling until a limit stops you. That is why a best plan is always at a <b>corner point</b>, and why checking the corners is enough:`,
          },
        ),
        cornerTable,
        h("p", { html: tie ? `Two corners tie at <b>${money(sol.best)}</b>, so this problem has <b>multiple optimal solutions</b>.` : `The best corner is <b>${point(opt)}</b> with a profit of <b>${money(sol.best)}</b>.` }),
      ),
    },
    {
      title: "Binding constraints and slack",
      body: h(
        "div",
        {},
        h(
          "p",
          {
            html: `A limit is <b>binding</b> when the plan uses all of it, and has <b>slack</b> when some is left over. At the best corner ${point(opt)}:`,
          },
        ),
        h("ul", { class: "ch-limit-list" }, limitLines),
        h("p", {}, "The binding limits are the shop's bottlenecks. If the owner wants more profit, those are the ones worth expanding."),
      ),
    },
    {
      title: tie ? "The iso-profit line and the tie" : "The iso-profit line",
      body: `<p>Every plan on an <b>iso-profit line</b> earns the same profit. The line's tilt comes from the two unit profits (${money(profit[0])} and ${money(profit[1])}), so it never changes. Raising profit just slides the line outward. The last point it touches before leaving the feasible region is the optimum.</p>${
        tie && par
          ? `<p>Here the iso-profit line has the same tilt as limit <b>${par.name}</b>: profits are in the ratio ${profit[0]} : ${profit[1]}, and ${par.name} is used in the ratio ${par.a} : ${par.b}, which is the same. The line leaves the region along that whole edge, so <b>every plan between ${sol.optimal
              .map(point)
              .join(" and ")}</b> earns ${money(sol.best)}.</p>`
          : ""
      }`,
    },
    {
      title: "Why not just make the product that pays more?",
      body: `<p>A tempting rule of thumb: make as many ${firstName} as possible (${money(Math.max(...profit))} each), then use what is left for ${secondName}. That gives ${point(greedy)} and <b>${money(greedy.profit)}</b>${
        greedy.profit >= sol.best - 1e-6
          ? ", which happens to be the optimum here. On other levels the same rule loses money."
          : `, which is ${money(sol.best - greedy.profit)} less than the optimum.`
      } Profit per unit ignores how much of the scarce resources each unit uses. A good mix uses the binding resources where they earn the most.</p>`,
    },
  ];

  const min = constraints.find((c) => c.kind === "min");
  if (min) {
    const free = bestWithout(problem, min.id);
    debrief.push({
      title: "What the minimum order costs",
      body: `<p>The shop promised a customer at least ${min.rhs} ${min.unit} per week. Without that promise the best profit would be ${money(free)}. ${
        free > sol.best + 1e-6
          ? `With it the best is ${money(sol.best)}, so the promise costs <b>${money(free - sol.best)}</b> per week. That is the least the shop should charge for agreeing to it.`
          : "With it the best is the same, because the best plan already makes more than the minimum. Here the promise costs nothing."
      }</p>`,
    });
  }

  const fig = drawPlot(problem, {
    width: plotWidth(document.querySelector(".g-screen")),
    reveal: true,
    label: `Feasible region with corner profits. Your plan ${point(you)} earns ${money(st.profit)}. The best corner ${point(opt)} earns ${money(sol.best)}.`,
  });
  fig.update(you, { iso: true, isoAt: sol.best, feasible: true });

  ctx.finish({
    outcome: stars === 3 ? "win" : stars === 2 ? "ok" : "miss",
    stars,
    headline: matched ? `${money(st.profit)} per week: the best the shop can do` : `${money(st.profit)} per week: ${pct(share)} of the best possible ${money(sol.best)}`,
    summary: `${where} Three stars need the optimum; two stars need at least ${pct(STAR_SHARES[1], 0)} of it.`,
    comparison: {
      caption: "Your plan compared with a rule of thumb and the best corner",
      columns: ["You", "Higher-profit product first", "Optimal corner"],
      rows: [
        { label: `x: ${story.x.name}`, values: [you, greedy, opt].map((p) => num(p.x)) },
        { label: `y: ${story.y.name}`, values: [you, greedy, opt].map((p) => num(p.y)) },
        { label: "Profit per week", values: [st.profit, greedy.profit, sol.best].map(money) },
        { label: "Share of the best profit", values: [st.profit, greedy.profit, sol.best].map((v) => pct(v / sol.best)) },
        ...constraints.map((c, i) => ({ label: slackLabel(c), values: [st, gSt, optSt].map((s) => (s.rows[i].state === "binding" ? "0 (binding)" : num(s.rows[i].slack))) })),
      ],
    },
    figure: h(
      "figure",
      { class: "ch-figure" },
      fig.el,
      h("figcaption", {}, `Each corner is labeled with its profit. The dashed line is the iso-profit line for ${money(sol.best)}, the highest that still touches the region.`),
    ),
    debrief,
  });
}
