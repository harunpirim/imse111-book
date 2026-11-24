// Lift Lab: redesign a lifting job until the NIOSH Lifting Index is 1 or less,
// for as little money as possible.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt } from "../shared/dom.js";
import {
  ASSUMPTIONS,
  LEVELS,
  LC,
  LI_LIMIT,
  LI_HIGH,
  H_MIN,
  H_MAX,
  V_REF,
  V_MAX,
  D_MAX,
  A_MAX,
  MULTIPLIERS,
  DURATIONS,
  COUPLINGS,
  hm,
  vm,
  dm,
  am,
  analyze,
  weakest,
  riskBand,
  generateLevel,
  evaluate,
  starsFor,
  describeJob,
  rateText,
  usd,
} from "./logic.js";

const MANUAL_URL = "https://stacks.cdc.gov/view/cdc/5434";

const f2 = (x) => fmt(x, 2);
const kg = (x) => `${fmt(x, 1)} kg`;
const liText = (li) => (Number.isFinite(li) ? f2(li) : "over 9");

function start(ctx) {
  const level = generateLevel(ctx.rng, ctx.level);
  const choice = level.factors.map(() => 0);
  const before = evaluate(level, choice);

  ctx.setStatus(
    h(
      "p",
      { class: "ll-brief" },
      h("strong", {}, `${ctx.level.name}: `),
      describeJob(level),
      " Redesign budget: ",
      h("strong", {}, usd(level.budget)),
      ".",
    ),
  );

  const metricsEl = h("div", { class: "g-metrics ll-metrics", "aria-label": "Job summary" });
  const sceneEl = h("div", { class: "ll-scene-wrap" });
  const meterEl = h("div", { class: "ll-meter-wrap" });
  const multEl = h("div", { class: "ll-mults" });
  const footEl = h("div", { class: "ll-foot" });

  const controls = level.factors.map((f, fi) =>
    h(
      "fieldset",
      { class: "ll-factor" },
      h("legend", {}, f.name, h("span", { class: "ll-factor-sym" }, ` changes ${symbolFor(f)}`)),
      f.options.map((o, oi) =>
        h(
          "label",
          { class: "ll-option" },
          h("input", {
            type: "radio",
            name: `ll-${f.id}`,
            value: String(oi),
            checked: oi === 0 ? true : null,
            onchange: () => {
              choice[fi] = oi;
              update(true);
            },
          }),
          h("span", { class: "ll-option-text" }, o.label),
          h("span", { class: "ll-option-cost" }, o.cost ? usd(o.cost) : "$0"),
        ),
      ),
    ),
  );

  replace(
    ctx.stage,
    metricsEl,
    h(
      "div",
      { class: "ll-grid" },
      h("section", { class: "g-card ll-scene-card", "aria-label": "Side view of the lift" }, h("h2", { class: "ll-h" }, "The lift, from the side"), sceneEl, meterEl),
      h("section", { class: "g-card ll-mult-card", "aria-label": "The six multipliers" }, h("h2", { class: "ll-h" }, "Six multipliers"), multEl),
    ),
    h("section", { class: "ll-controls", "aria-label": "Redesign options" }, h("h2", { class: "ll-h" }, "Redesign options: one per factor"), h("div", { class: "ll-factors" }, controls)),
    footEl,
  );

  function metric(label, value, state) {
    return h("div", { class: "g-metric", dataset: state ? { state } : {} }, h("span", { class: "g-metric-label" }, label), h("span", { class: "g-metric-value" }, value));
  }

  function update(announce) {
    const e = evaluate(level, choice);
    const a = e.analysis;
    const band = riskBand(a.li);
    const left = level.budget - e.cost;

    replace(
      metricsEl,
      metric("Load", `${fmt(e.job.load, e.job.load % 1 ? 1 : 0)} kg`),
      metric("Weight limit (RWL)", kg(a.RWL)),
      metric("Lifting Index", liText(a.li), band.state),
      metric("Redesign cost", usd(e.cost), e.withinBudget ? null : "bad"),
      metric("Budget left", left >= 0 ? usd(left) : `−${usd(-left)}`, left < 0 ? "bad" : null),
    );
    replace(sceneEl, drawScene(e.job));
    replace(meterEl, liMeter(a.li));
    replace(multEl, multiplierRows(a, analyze(level.base)), rwlLine(a));

    const fixed = a.ok && e.withinBudget;
    const note = !e.withinBudget
      ? `To submit: you are ${usd(-left)} over budget. Undo a change.`
      : a.ok
        ? "The Lifting Index is 1.00 or less, within budget. Submit, or look for a cheaper fix."
        : `The Lifting Index is ${liText(a.li)}, still above 1. Keep going. The smallest multiplier is the best place to look.`;
    replace(
      footEl,
      h(
        "div",
        { class: "g-actions" },
        h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", disabled: e.withinBudget ? null : true, onclick: submit }, "Submit redesign"),
        h(
          "button",
          {
            type: "button",
            class: "g-btn g-btn-ghost",
            onclick: () => {
              choice.fill(0);
              ctx.stage.querySelectorAll(".ll-factor").forEach((fs) => (fs.querySelector("input").checked = true));
              update(true);
            },
          },
          "Undo all changes",
        ),
      ),
      h("p", { class: `ll-note${fixed ? " is-ok" : ""}`, role: "note" }, note),
    );
    if (announce) ctx.announce(`Lifting Index ${liText(a.li)}, ${band.label}. Cost ${usd(e.cost)} of ${usd(level.budget)}.`);
  }

  function submit() {
    const mine = evaluate(level, choice);
    if (!mine.withinBudget) return;
    const best = { ...evaluate(level, level.best.choice) };
    const stars = starsFor(mine, level.best);
    const a = mine.analysis;
    const b = before.analysis;
    const o = best.analysis;
    const picked = (c) => level.factors.map((f, i) => (c[i] ? f.options[c[i]].label : null)).filter(Boolean);
    const extra = mine.cost - best.cost;

    const headline = !a.ok
      ? `Lifting Index ${liText(a.li)}: the job is still above 1`
      : stars === 3
        ? `Fixed for ${usd(mine.cost)}, the cheapest fix there is`
        : `Fixed for ${usd(mine.cost)}; ${usd(best.cost)} was enough`;
    const summary = !a.ok
      ? `The weight limit for your design is <b>${kg(a.RWL)}</b>, but the load is ${fmt(mine.job.load, 1)} kg. The cheapest fix costs <b>${usd(best.cost)}</b>: ${picked(level.best.choice).join("; ")}.`
      : stars === 3
        ? `You raised the weight limit from ${kg(b.RWL)} to <b>${kg(a.RWL)}</b> and brought the Lifting Index from ${liText(b.li)} down to <b>${liText(a.li)}</b>. No cheaper combination of options gets to 1.`
        : `Your design works: the Lifting Index fell from ${liText(b.li)} to <b>${liText(a.li)}</b>. It cost ${usd(extra)} more than the cheapest fix: ${picked(level.best.choice).join("; ")}.`;

    const cols = [mine, before, best];
    const row = (label, fn) => ({ label, values: cols.map(fn) });
    ctx.finish({
      outcome: !a.ok ? "miss" : stars === 3 ? "win" : "ok",
      stars,
      headline,
      summary,
      comparison: {
        caption: "Your redesign, the job as you found it, and the cheapest redesign with a Lifting Index of 1 or less",
        columns: ["You", "Before", "Cheapest fix"],
        rows: [
          row("Lifting Index", (x) => liText(x.analysis.li)),
          row("Weight limit, RWL (kg)", (x) => fmt(x.analysis.RWL, 1)),
          row("Load (kg)", (x) => fmt(x.job.load, x.job.load % 1 ? 1 : 0)),
          row("Redesign cost", (x) => usd(x.cost)),
          row("Options changed", (x) => String(x.changes)),
          ...MULTIPLIERS.map((m) => row(`${m.id} · ${m.name.toLowerCase()}`, (x) => f2(x.analysis[m.id]))),
        ],
      },
      figure: h(
        "div",
        { class: "ll-result-fig" },
        compareChart([
          { name: "Before", a: b, cls: "ll-s-before" },
          { name: "You", a, cls: "ll-s-you" },
          { name: "Cheapest fix", a: o, cls: "ll-s-best" },
        ]),
        h(
          "div",
          { class: "ll-fixlists" },
          fixList("Your changes", picked(choice), mine.cost),
          fixList("Cheapest fix", picked(level.best.choice), best.cost),
        ),
      ),
      debrief: debrief(level, mine, before, best),
    });
  }

  update(false);
}

function symbolFor(f) {
  return { reach: "HM", origin: "VM and DM", dest: "DM", twist: "AM", rate: "FM", hours: "FM", grip: "CM", load: "the load and FM" }[f.id];
}

function fixList(title, items, cost) {
  return h(
    "div",
    { class: "ll-fixlist" },
    h("h3", {}, `${title} · ${usd(cost)}`),
    items.length ? h("ul", {}, items.map((t) => h("li", {}, t))) : h("p", {}, "No changes."),
  );
}

// ---------------------------------------------------------------- multipliers

function multiplierRows(a, base) {
  const weak = weakest(a);
  return h(
    "ul",
    { class: "ll-mult-list" },
    MULTIPLIERS.map((m) => {
      const v = a[m.id];
      const was = base[m.id];
      const changed = Math.abs(v - was) > 1e-9;
      return h(
        "li",
        { class: `ll-mult${m.id === weak ? " is-weakest" : ""}` },
        h("span", { class: "ll-mult-id" }, m.id),
        h(
          "span",
          { class: "ll-mult-main" },
          h("span", { class: "ll-mult-name" }, m.name, m.id === weak ? h("span", { class: "ll-tag" }, "▼ biggest loss") : null),
          h(
            "span",
            { class: "ll-mult-bar", role: "img", "aria-label": `${m.name} multiplier ${f2(v)}${changed ? `, was ${f2(was)}` : ""}` },
            h("span", { class: "ll-mult-was", style: `width:${100 * was}%` }),
            h("span", { class: "ll-mult-fill", style: `width:${100 * v}%` }),
          ),
          h("span", { class: "ll-mult-what" }, m.what),
        ),
        h("span", { class: "ll-mult-val" }, f2(v), changed ? h("span", { class: "ll-mult-delta" }, `was ${f2(was)}`) : null),
      );
    }),
  );
}

function rwlLine(a) {
  return h(
    "p",
    { class: "g-formula ll-rwl" },
    `RWL = ${LC} × ${MULTIPLIERS.map((m) => f2(a[m.id])).join(" × ")} = ${fmt(a.RWL, 1)} kg`,
  );
}

function liMeter(li) {
  const band = riskBand(li);
  const cap = 4;
  const pos = Math.min(100, (100 * Math.min(li, cap)) / cap);
  return h(
    "div",
    { class: "ll-meter", role: "img", "aria-label": `Lifting Index ${liText(li)}: ${band.label}` },
    h("div", { class: "ll-meter-head" }, h("span", {}, "Lifting Index = load ÷ RWL"), h("strong", { class: `ll-meter-read ll-${band.id}` }, `${liText(li)} · ${band.label}`)),
    h(
      "div",
      { class: "ll-meter-track" },
      h("span", { class: "ll-zone ll-zone-ok", style: `width:${(100 * LI_LIMIT) / cap}%` }, "OK"),
      h("span", { class: "ll-zone ll-zone-raised", style: `width:${(100 * (LI_HIGH - LI_LIMIT)) / cap}%` }, "Increased risk"),
      h("span", { class: "ll-zone ll-zone-high", style: `width:${(100 * (cap - LI_HIGH)) / cap}%` }, "High"),
      h("span", { class: "ll-pin", style: `left:${pos}%` }),
    ),
    h(
      "div",
      { class: "ll-meter-scale", "aria-hidden": "true" },
      [0, 1, 2, 3, 4].map((t) => h("span", { style: `left:${(100 * t) / cap}%` }, t === cap ? "4+" : String(t))),
    ),
  );
}

// ---------------------------------------------------------------- side view

const K = 1.02; // px per cm
const FLOOR = 214;
const AX = 148; // x of the ankles in px
const px = (cmX) => AX + cmX * K;
const py = (cmY) => FLOOR - cmY * K;

/** Bend the trunk and knees just enough for the hands to reach (H, V). All in cm. */
function pose(H, V) {
  const TRUNK = 50;
  const REACH = 60;
  let best = null;
  for (let s = 0; s <= 1.001; s += 0.1) {
    const hip = { x: -12 * s, y: 90 - 42 * s };
    for (let deg = 0; deg <= 100; deg += 2) {
      const t = (deg * Math.PI) / 180;
      const sh = { x: hip.x + TRUNK * Math.sin(t), y: hip.y + TRUNK * Math.cos(t) };
      const d = Math.hypot(H - sh.x, V - sh.y);
      const cost = d <= REACH ? deg / 100 + 0.9 * s : 10 + d;
      if (!best || cost < best.cost) best = { cost, hip, sh, t };
    }
  }
  const { hip, sh, t } = best;
  const twoLink = (p, q, a, b, pickHigherX) => {
    const d = Math.min(Math.hypot(q.x - p.x, q.y - p.y), a + b - 0.01);
    const base = Math.atan2(q.y - p.y, q.x - p.x);
    const off = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
    const c1 = { x: p.x + a * Math.cos(base + off), y: p.y + a * Math.sin(base + off) };
    const c2 = { x: p.x + a * Math.cos(base - off), y: p.y + a * Math.sin(base - off) };
    return pickHigherX ? (c1.x > c2.x ? c1 : c2) : c1.y < c2.y ? c1 : c2;
  };
  const hand = { x: H, y: V };
  const elbow = twoLink(sh, hand, 30, 31, false);
  const knee = twoLink(hip, { x: 0, y: 8 }, 44, 42, true);
  const head = { x: sh.x + 17 * Math.sin(t * 0.8), y: sh.y + 17 * Math.cos(t * 0.8) };
  return { hip, sh, elbow, hand, knee, head };
}

function drawScene(job) {
  const P = (p) => `${fmt(px(p.x), 1)},${fmt(py(p.y), 1)}`;
  const D = Math.abs(job.Vdest - job.V);
  const BOX = { w: 36, h: 26 };
  const p = pose(job.H, job.V);
  const destX = -72;
  const els = [];
  const line = (x1, y1, x2, y2, cls) => svg("line", { x1, y1, x2, y2, class: cls });
  const text = (x, y, cls, str, anchor) => svg("text", { x, y, class: cls, "text-anchor": anchor || "middle" }, str);

  // floor
  els.push(line(-28, FLOOR, 314, FLOOR, "ll-floor"));

  // set-down shelf (left) with a ghost box
  const shelfY = py(job.Vdest - BOX.h / 2);
  els.push(
    svg("rect", { x: px(destX - 22), y: shelfY, width: 44 * K, height: 5, class: "ll-shelf" }),
    line(px(destX - 20), shelfY + 5, px(destX - 20), FLOOR, "ll-post"),
    svg("rect", { x: px(destX - BOX.w / 2), y: py(job.Vdest + BOX.h / 2), width: BOX.w * K, height: BOX.h * K, rx: 2, class: "ll-box-ghost" }),
    text(px(destX), py(job.Vdest + BOX.h / 2) - 5, "ll-lab", "set down"),
  );

  // pick-up support (right) and the box
  const supY = py(job.V - BOX.h / 2);
  els.push(svg("rect", { x: px(job.H - 26), y: supY, width: 52 * K, height: Math.max(3, FLOOR - supY), class: "ll-stand" }));
  const bx = px(job.H - BOX.w / 2);
  const by = py(job.V + BOX.h / 2);
  els.push(svg("rect", { x: bx, y: by, width: BOX.w * K, height: BOX.h * K, rx: 2, class: "ll-box" }));
  if (job.coupling !== "poor") {
    // hand-holds (fair) or full handles (good)
    const w = job.coupling === "good" ? 14 : 8;
    els.push(svg("rect", { x: px(job.H) - w / 2, y: py(job.V) - 3, width: w, height: job.coupling === "good" ? 6 : 4, rx: 2, class: "ll-handle" }));
  }

  // travel arrow from pick-up to set-down
  const sx = px(job.H);
  const sy = by - 3;
  const ex = px(destX) + 4;
  const ey = py(job.Vdest + BOX.h / 2) - 18;
  const topY = Math.min(sy, ey, py(165)) - 14;
  els.push(svg("path", { d: `M${sx},${sy} C${sx},${topY} ${ex + 30},${topY} ${ex},${ey + 6}`, class: "ll-travel", "marker-end": "url(#ll-arrow)" }));

  // worker
  els.push(
    svg("polyline", { points: `${P(p.hip)} ${P(p.knee)} ${P({ x: 0, y: 8 })} ${P({ x: 16, y: 3 })}`, class: "ll-limb" }),
    svg("polyline", { points: `${P(p.hip)} ${P(p.sh)}`, class: "ll-trunk" }),
    svg("polyline", { points: `${P(p.sh)} ${P(p.elbow)} ${P(p.hand)}`, class: "ll-limb ll-arm" }),
    svg("circle", { cx: px(p.head.x), cy: py(p.head.y), r: 10.5, class: "ll-head" }),
    svg("path", { d: `M${px(p.head.x) - 11},${py(p.head.y) - 2} a11,11 0 0 1 22,0 z`, class: "ll-hat" }),
  );

  els.push(text(px(job.H), by + BOX.h * K - 6, "ll-box-kg", `${fmt(job.load, job.load % 1 ? 1 : 0)} kg`));

  // dimensions: H along the floor, V beside the box, D beside the shelf
  const dimY = FLOOR + 14;
  els.push(
    line(px(0), dimY, px(job.H), dimY, "ll-dim"),
    line(px(0), dimY - 4, px(0), dimY + 4, "ll-dim"),
    line(px(job.H), dimY - 4, px(job.H), dimY + 4, "ll-dim"),
    text((px(0) + px(job.H)) / 2, dimY + 14, "ll-dim-lab", `H ${job.H} cm`),
  );
  const vx = px(job.H + 34);
  els.push(
    line(vx, FLOOR, vx, py(job.V), "ll-dim"),
    line(vx - 4, py(job.V), vx + 4, py(job.V), "ll-dim"),
    text(vx + 5, Math.min(FLOOR - 4, (FLOOR + py(job.V)) / 2 + 4), "ll-dim-lab", `V ${job.V} cm`, "start"),
  );
  const dx = px(destX - 30);
  els.push(
    line(dx, py(job.V), dx, py(job.Vdest), "ll-dim"),
    line(dx - 4, py(job.V), dx + 4, py(job.V), "ll-dim"),
    line(dx - 4, py(job.Vdest), dx + 4, py(job.Vdest), "ll-dim"),
    text(dx - 5, (py(job.V) + py(job.Vdest)) / 2 + 4, "ll-dim-lab", `D ${D} cm`, "end"),
  );

  // twist dial (top view)
  const cx = 276;
  const cy = 34;
  const r = 20;
  const ang = (job.A * Math.PI) / 180;
  els.push(
    svg("circle", { cx, cy, r, class: "ll-dial" }),
    line(cx, cy, cx, cy - r, "ll-dial-ref"),
    line(cx, cy, cx + r * Math.sin(ang), cy - r * Math.cos(ang), "ll-dial-arm"),
    job.A > 0 ? svg("path", { d: `M${cx},${cy - 11} A11,11 0 0 1 ${cx + 11 * Math.sin(ang)},${cy - 11 * Math.cos(ang)}`, class: "ll-dial-arc" }) : null,
    text(cx, cy + r + 13, "ll-dim-lab", `twist A ${job.A}°`),
    text(cx, cy - r - 4, "ll-lab", "top view"),
  );

  const d = DURATIONS.find((x) => x.id === job.duration);
  const c = COUPLINGS.find((x) => x.id === job.coupling);
  return h(
    "div",
    { class: "ll-scene" },
    svg(
      "svg",
      {
        viewBox: "-36 0 356 248",
        class: "ll-svg",
        role: "img",
        "aria-label": `Side view. A worker lifts a ${job.load} kilogram load held ${job.H} centimeters in front of the ankles, from ${job.V} centimeters above the floor to ${job.Vdest} centimeters, twisting ${job.A} degrees.`,
      },
      svg("defs", {}, svg("marker", { id: "ll-arrow", viewBox: "0 0 10 10", refX: 7, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" }, svg("path", { d: "M0,0 L10,5 L0,10 z" }))),
      els,
    ),
    h(
      "p",
      { class: "ll-chips" },
      h("span", { class: "ll-chip" }, `Pace: ${rateText(job.F)}`),
      h("span", { class: "ll-chip" }, `Lifting for ${d.label}`),
      h("span", { class: "ll-chip" }, `Grip: ${c.label.toLowerCase()}`),
    ),
  );
}

// ---------------------------------------------------------------- results

/** Grouped bars: each multiplier before, in the player's design, and in the cheapest fix. */
function compareChart(series) {
  const rowH = 46;
  const left = 34;
  const W = 330;
  const barW = W - left - 44;
  const H = MULTIPLIERS.length * rowH + 22;
  const els = [];
  [0, 0.5, 1].forEach((t) => {
    const x = left + t * barW;
    els.push(svg("line", { x1: x, x2: x, y1: 4, y2: H - 18, class: "ll-cc-grid" }), svg("text", { x, y: H - 5, class: "ll-cc-tick" }, fmt(t, 1)));
  });
  MULTIPLIERS.forEach((m, i) => {
    const y0 = 6 + i * rowH;
    els.push(svg("text", { x: 0, y: y0 + 23, class: "ll-cc-id" }, m.id));
    series.forEach((s, j) => {
      const v = s.a[m.id];
      const y = y0 + j * 12;
      els.push(
        svg("rect", { x: left, y, width: Math.max(1, v * barW), height: 10, class: `ll-cc-bar ${s.cls}` }),
        svg("text", { x: left + v * barW + 4, y: y + 9, class: "ll-cc-val" }, f2(v)),
      );
    });
  });
  return h(
    "figure",
    { class: "ll-cc" },
    svg(
      "svg",
      {
        viewBox: `0 0 ${W} ${H}`,
        role: "img",
        "aria-label": `Multipliers compared. ${MULTIPLIERS.map((m) => `${m.name}: ${series.map((s) => `${s.name} ${f2(s.a[m.id])}`).join(", ")}`).join(". ")}.`,
      },
      els,
    ),
    h(
      "figcaption",
      {},
      series.map((s) => h("span", { class: "ll-cc-key" }, h("span", { class: `ll-cc-swatch ${s.cls}`, "aria-hidden": "true" }), s.name)),
      h("span", { class: "ll-cc-note" }, "Longer bars are better. 1.00 means no penalty."),
    ),
  );
}

function debrief(level, mine, before, best) {
  const a = mine.analysis;
  const j = mine.job;
  const b = before.analysis;
  const weak = weakest(b);
  const weakM = MULTIPLIERS.find((m) => m.id === weak);
  const lesson = {
    warmup: `In this job the biggest loss was the <b>${weakM.name.toLowerCase()} multiplier</b> (${f2(b[weak])}). Fixing the smallest multiplier first usually gives the most for the money.`,
    pace: `This job looked like a height problem, because the lift started low. But the hands started only ${Math.abs(level.base.V - V_REF)} cm from the best height, which costs just ${fmt(100 * (1 - b.VM), 0)}%. The pace and the hours cost ${fmt(100 * (1 - b.FM), 0)}%. Slowing down or rotating workers was the better buy.`,
    reach: `This job was slow, so the frequency multiplier was already near 1 (${f2(b.FM)}). The long reach was the problem: holding the load ${level.base.H} cm away cut the limit to ${fmt(100 * b.HM, 0)}% before anything else. Bringing the load closer beat raising the pick-up point.`,
    heavy: `The load was ${level.base.load} kg, heavier than the ${LC} kg load constant. Every multiplier is at most 1, so the weight limit can never go above ${LC} kg. No change to the workplace could fix this job: <b>the load itself had to change</b>. Half-size packs also double the lifts, so the frequency multiplier dropped a little.`,
    tight: `With a tight budget, compare what each dollar buys. A cheap option that lifts a small multiplier can beat an expensive one that lifts a multiplier already near 1.`,
  }[level.kind];

  const hRows = [H_MIN, 40, 50, H_MAX].map((H) => `<tr><th scope="row">${H} cm</th><td>${f2(hm(H))}</td></tr>`).join("");
  return [
    {
      title: "The lifting equation with your numbers",
      body: h(
        "div",
        {},
        h("p", { class: "g-formula" }, `RWL = LC × HM × VM × DM × AM × FM × CM = ${LC} × ${MULTIPLIERS.map((m) => f2(a[m.id])).join(" × ")} = ${fmt(a.RWL, 1)} kg`),
        h("p", { class: "g-formula" }, `LI = load ÷ RWL = ${fmt(j.load, 1)} ÷ ${fmt(a.RWL, 1)} = ${liText(a.li)}`),
        h(
          "p",
          {},
          `The recommended weight limit (RWL) starts at the load constant, ${LC} kg, for a perfect lift: close to the body, at knuckle height, with no twist, rarely, with a good grip. Each multiplier is between 0 and 1 and takes something away for a way your lift is less than perfect.`,
        ),
      ),
    },
    {
      title: "What each multiplier means",
      body: h(
        "ul",
        { class: "ll-deb-list" },
        h("li", { html: `<b>HM = 25 ÷ H = ${f2(a.HM)}.</b> H is how far the hands are in front of the ankles (${j.H} cm). Farther away means a longer lever on the lower back.` }),
        h("li", { html: `<b>VM = 1 − 0.003 × |V − 75| = ${f2(a.VM)}.</b> V is the height of the hands at the start (${j.V} cm). Knuckle height, 75 cm, is best. Bending low or reaching high both cost.` }),
        h("li", { html: `<b>DM = 0.82 + 4.5 ÷ D = ${f2(a.DM)}.</b> D is how far the load travels up or down (${a.D} cm). It never drops below ${f2(dm(D_MAX))}.` }),
        h("li", { html: `<b>AM = 1 − 0.0032 × A = ${f2(a.AM)}.</b> A is the twist angle (${j.A}°). Turning the feet instead of the trunk makes it 1.` }),
        h("li", { html: `<b>FM = ${f2(a.FM)}</b>, from a table: ${rateText(j.F)} for ${DURATIONS.find((d) => d.id === j.duration).label}. Fast lifting for a long time tires the body.` }),
        h("li", { html: `<b>CM = ${f2(a.CM)}</b>, from a table: a ${j.coupling} grip. Handles or hand-holds make the load easier to control.` }),
      ),
    },
    {
      title: "Why reach matters most",
      body: `<p>Of the four geometry multipliers, reach has the widest swing. Holding a load ${H_MAX} cm away leaves only ${fmt(100 * hm(H_MAX), 0)}% of the limit. The worst allowed height (${V_MAX} cm) still leaves ${fmt(100 * vm(V_MAX), 0)}%, the longest travel ${fmt(100 * dm(D_MAX), 0)}%, and the largest twist (${A_MAX}°) ${fmt(100 * am(A_MAX), 0)}%.</p>
        <div class="g-table-wrap"><table class="g-table ll-mini"><caption>HM = 25 ÷ H</caption><thead><tr><th scope="col">Reach H</th><th scope="col">HM</th></tr></thead><tbody>${hRows}</tbody></table></div>
        <p>So the first question for any lifting job is: <b>can the load come closer to the body?</b> Turntables, tilt stands, and cut-away bins exist for this reason. Only pace and hours (FM) can shrink the limit by more.</p>`,
    },
    {
      title: "Reading the Lifting Index",
      body: `<p>${lesson}</p>
        <p><b>LI of ${LI_LIMIT} or less:</b> the goal for every lifting job. <b>Above ${LI_LIMIT}:</b> an increased risk of lifting-related low back pain for some workers, growing as the index grows. <b>Above ${LI_HIGH}:</b> nearly all workers are at increased risk. Your job went from ${liText(b.li)} to ${liText(a.li)}; the cheapest fix reaches ${liText(best.analysis.li)} for ${usd(best.cost)}.</p>
        <p class="ll-source">Source for the equation, tables, and limits: Waters, Putz-Anderson, and Garg (1994), <a href="${MANUAL_URL}" target="_blank" rel="noopener"><i>Applications Manual for the Revised NIOSH Lifting Equation</i></a>, DHHS (NIOSH) Publication No. 94-110. The redesign options and prices are invented for this game.</p>`,
    },
  ];
}

// Start last, so every helper above exists even when ?autostart=1 begins a round at once.
createGame({
  slug: "lift-lab",
  title: "Lift Lab",
  tagline: "Redesign the job, not the worker.",
  objective:
    "read the six multipliers of the NIOSH lifting equation, find which one hurts a lifting job most, and bring its Lifting Index to 1 or less for the least money.",
  minutes: "10-15",
  chapter: { href: "../../chapters/week-06.html", label: "Week 6 · Work Design, Methods, and Human Factors" },
  howToPlay: [
    "Each job starts unsafe: its <b>Lifting Index (LI)</b> is above 1. The picture shows the lift from the side.",
    "Pick <b>one option per factor</b>: bring the load closer, raise the pick-up point, lower the shelf, remove the twist, slow the pace, shorten the hours, or improve the grip. Every change costs money.",
    "Watch the <b>six multipliers</b>. Each is a number from 0 to 1 that shrinks the weight limit. The smallest one is hurting the job most.",
    "Get the LI to <b>1.00 or less</b> within the budget, then press <b>Submit redesign</b>. You are compared with the cheapest fix that exists.",
    "Keyboard: <kbd>Tab</kbd> moves between factors, the arrow keys change an option.",
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start,
});
