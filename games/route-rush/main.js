// Route Rush: build delivery routes from one depot by picking customers in
// order, then compare them with nearest neighbor, 2-opt, and the best plan.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt, pct } from "../shared/dom.js";
import {
  ASSUMPTIONS,
  LEVELS,
  GRID,
  MAP_KM,
  EXACT_LIMIT,
  EPS,
  STAR_GAPS,
  generateInstance,
  evaluate,
  routeLoad,
  nearestNeighbor,
  twoOpt,
  optimalPlan,
  bestFound,
  singleTourLength,
  minTrucks,
  tourCount,
  longestLeg,
  countCrossings,
  gap,
  starsFor,
} from "./logic.js";

// Each truck has a palette color and its own line pattern, so trucks can be
// told apart without color. The route list next to the map says it in words.
const TRUCK_DASH = [null, "9 5", "2 6"];
const truckColor = (t) => `var(--c${(t % 3) + 1})`;
const km = (x) => `${fmt(x, 1)} km`;
const boxes = (n) => `${n} box${n === 1 ? "" : "es"}`;

createGame({
  slug: "route-rush",
  title: "Route Rush",
  tagline: "Every stop, every box, the fewest kilometers.",
  objective:
    "build delivery routes that visit every customer, respect truck capacity, and explain why a quick rule of thumb (a heuristic) can miss the shortest route.",
  minutes: "10-15",
  chapter: { href: "../../chapters/week-09.html", label: "Week 9 · Supply Chains, Logistics, and Facilities" },
  howToPlay: [
    "Trucks leave the <b>depot</b> (the dark square with a house), visit customers, and drive back. Your goal is the <b>shortest total distance</b>.",
    "Tap a customer to add it as the next stop of the active truck. Tap a routed customer to take it off its route.",
    "From Level 3 on, each customer orders a number of boxes (the small tag) and a truck can only carry so many. Pick a truck in the list to make it the active one.",
    "Keyboard: <kbd>Tab</kbd> to a customer and press <kbd>Enter</kbd>. <kbd>1</kbd>-<kbd>3</kbd> picks a truck and <kbd>U</kbd> undoes the last stop.",
    "When every customer is on a route, press <b>Submit routes</b> to see how you did against three benchmarks.",
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start,
});

function start(ctx) {
  const inst = generateInstance(ctx.rng, ctx.level);
  const { nodes, trucks } = inst;
  const capacitated = Number.isFinite(inst.capacity);
  const plan = Array.from({ length: trucks }, () => []);
  let active = 0;
  let note = null; // short message about the last action

  ctx.setStatus(
    h(
      "p",
      { class: "rr-brief" },
      h("strong", {}, `${ctx.level.name}: `),
      trucks === 1
        ? `one truck leaves the depot, visits all ${inst.n} customers, and comes back. `
        : `${trucks} trucks serve ${inst.n} customers. Each truck starts and ends at the depot and carries at most ${inst.capacity} boxes (${inst.totalDemand} boxes ordered in total). `,
      "Make the total distance as short as you can.",
    ),
  );

  const metricsEl = h("div", { class: "g-metrics rr-metrics", "aria-label": "Route metrics" });
  const mapEl = h("div", { class: "rr-map" });
  const readout = h("p", { class: "rr-readout", "aria-hidden": "true" });
  const panelEl = h("div", { class: "rr-panel" });
  replace(
    ctx.stage,
    metricsEl,
    h(
      "div",
      { class: "rr-grid" },
      h(
        "section",
        { class: "g-card rr-map-card", "aria-label": "Map" },
        mapEl,
        readout,
        h(
          "p",
          { class: "rr-legend" },
          `Map: ${MAP_KM} km × ${MAP_KM} km, grid lines every 2 km.`,
          capacitated ? " The tag on a customer is the number of boxes ordered." : "",
          " A number in a dark circle is the stop order.",
        ),
      ),
      h("section", { class: "rr-side", "aria-label": "Trucks and routes" }, panelEl),
    ),
  );

  const where = (id) => {
    for (let t = 0; t < plan.length; t++) {
      const i = plan[t].indexOf(id);
      if (i >= 0) return { truck: t, stop: i };
    }
    return null;
  };
  const tail = (t) => (plan[t].length ? plan[t][plan[t].length - 1] : 0);
  const name = (id) => (id === 0 ? "the depot" : nodes[id].label);

  function toggle(id) {
    const at = where(id);
    const c = nodes[id];
    if (at) {
      plan[at.truck].splice(at.stop, 1);
      note = { kind: "info", text: `${c.label} taken off truck ${at.truck + 1}.` };
    } else if (routeLoad(inst, plan[active]) + c.demand > inst.capacity) {
      const room = inst.capacity - routeLoad(inst, plan[active]);
      note = { kind: "bad", text: `${c.label} doesn't fit on truck ${active + 1}: it needs ${boxes(c.demand)} and only ${room} more fit${room === 1 ? "s" : ""}. Pick another truck.` };
    } else {
      plan[active].push(id);
      note = { kind: "info", text: `${c.label} is stop ${plan[active].length} of truck ${active + 1}.` };
    }
    ctx.announce(note.text);
    render(`c-${id}`);
  }

  function setActive(t, focusKey) {
    if (t < 0 || t >= trucks) return;
    active = t;
    note = null;
    render(focusKey || `truck-${t}`);
    ctx.announce(`Truck ${t + 1} is active.`);
  }

  function undo() {
    if (!plan[active].length) return;
    const id = plan[active].pop();
    note = { kind: "info", text: `${nodes[id].label} taken off truck ${active + 1}.` };
    ctx.announce(note.text);
    render("undo");
  }

  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= trucks) {
      e.preventDefault();
      setActive(Number(e.key) - 1);
    } else if (e.key === "u" || e.key === "U") {
      e.preventDefault();
      undo();
    }
  }
  document.addEventListener("keydown", onKey);
  ctx.onCleanup(() => document.removeEventListener("keydown", onKey));

  function hover(id) {
    if (id == null) {
      readout.textContent = `Tap a customer to add it to truck ${active + 1}.`;
      return;
    }
    const at = where(id);
    const c = nodes[id];
    const order = capacitated ? ` (${boxes(c.demand)})` : "";
    readout.textContent = at
      ? `${c.label}${order} is stop ${at.stop + 1} of truck ${at.truck + 1}. Tap to remove it.`
      : `${c.label}${order}: ${km(inst.d[tail(active)][id])} from ${name(tail(active))}, ${km(inst.d[id][0])} from the depot.`;
  }

  function metric(label, value, state) {
    return h("div", { class: "g-metric", dataset: state ? { state } : {} }, h("span", { class: "g-metric-label" }, label), h("span", { class: "g-metric-value" }, value));
  }

  function render(focusKey) {
    const key = focusKey || document.activeElement?.dataset?.key;
    const m = evaluate(inst, plan);

    replace(
      metricsEl,
      metric("Total distance", km(m.total)),
      metric("Customers routed", `${inst.n - m.unvisited.length} / ${inst.n}`, m.complete ? "good" : null),
      trucks > 1 ? metric("Trucks used", `${m.trucksUsed} / ${trucks}`) : null,
      capacitated ? metric(`Truck ${active + 1} load`, `${m.loads[active]} / ${inst.capacity}`, m.loads[active] === inst.capacity ? "warn" : null) : null,
    );

    replace(mapEl, drawMap(inst, plan, { interactive: true, active, where, toggle, hover }));
    hover(null);

    const truckCards = plan.map((route, t) => {
      const isActive = t === active;
      return h(
        "button",
        {
          type: "button",
          class: `rr-truck${isActive ? " is-active" : ""}`,
          role: "radio",
          "aria-checked": String(isActive),
          dataset: { key: `truck-${t}` },
          style: `--tk:${truckColor(t)}`,
          onclick: () => setActive(t),
        },
        h(
          "span",
          { class: "rr-truck-head" },
          h("span", { class: "rr-truck-name" }, lineSwatch(t), `Truck ${t + 1}`, isActive && trucks > 1 ? h("span", { class: "rr-active-tag" }, "active") : null),
          h("span", { class: "rr-truck-km" }, km(m.lengths[t])),
        ),
        h("span", { class: "rr-truck-route" }, route.length ? `Depot → ${route.map((id) => nodes[id].label).join(" → ")} → Depot` : "No stops yet"),
        capacitated
          ? h(
              "span",
              { class: "rr-load" },
              h("span", { class: "rr-load-bar", "aria-hidden": "true" }, h("span", { class: "rr-load-fill", style: `width:${(100 * m.loads[t]) / inst.capacity}%` })),
              h("span", { class: "rr-load-text" }, `${m.loads[t]} / ${inst.capacity} boxes`),
            )
          : null,
      );
    });

    const left = m.unvisited.map((id) => nodes[id].label);
    replace(
      panelEl,
      h("h2", { class: "rr-h", id: "rr-trucks-label" }, trucks > 1 ? "Trucks (pick the active one)" : "Your route"),
      h("div", { class: "rr-trucks", role: "radiogroup", "aria-labelledby": "rr-trucks-label" }, truckCards),
      note ? h("p", { class: `rr-note is-${note.kind}` }, note.kind === "bad" ? "✖ " : "", note.text) : null,
      h(
        "div",
        { class: "rr-tools" },
        h("button", { type: "button", class: "g-btn", dataset: { key: "undo" }, disabled: plan[active].length ? null : true, onclick: undo }, "Undo last stop"),
        h(
          "button",
          {
            type: "button",
            class: "g-btn g-btn-ghost",
            dataset: { key: "clear" },
            disabled: plan.some((r) => r.length) ? null : true,
            onclick: () => {
              plan.forEach((r) => (r.length = 0));
              note = null;
              render("clear");
              ctx.announce("All routes cleared.");
            },
          },
          "Clear all",
        ),
      ),
      h(
        "div",
        { class: "g-actions rr-submit" },
        h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", dataset: { key: "submit" }, disabled: m.feasible ? null : true, onclick: submit }, "Submit routes"),
      ),
      h(
        "p",
        { class: `rr-problems${m.feasible ? " is-ok" : ""}`, role: "note" },
        m.feasible
          ? "Every customer is on a route. Submit, or keep improving."
          : `To submit: ${left.length} customer${left.length === 1 ? "" : "s"} still need${left.length === 1 ? "s" : ""} a truck (${left.join(", ")}).`,
      ),
    );

    if (key) ctx.stage.querySelector(`[data-key="${key}"]`)?.focus({ preventScroll: true });
  }

  function submit() {
    const m = evaluate(inst, plan);
    if (!m.feasible) return;
    showResults(ctx, inst, plan.filter((r) => r.length));
  }

  render();
}

/** A short sample of a truck's line pattern, for legends. */
function lineSwatch(t) {
  return svg(
    "svg",
    { class: "rr-swatch", viewBox: "0 0 28 10", width: 28, height: 10, "aria-hidden": "true" },
    svg("line", { x1: 1, y1: 5, x2: 27, y2: 5, class: "rr-leg", style: `stroke:${truckColor(t)}`, "stroke-dasharray": TRUCK_DASH[t % 3] }),
  );
}

/**
 * Draw the map with a plan's routes.
 * o.interactive  customers become buttons (o.toggle, o.hover, o.where, o.active)
 * o.label        accessible name for a static map
 */
function drawMap(inst, plan, o = {}) {
  const S = 420;
  const pad = 28;
  const px = (v) => pad + (v / GRID) * (S - 2 * pad);
  const capacitated = Number.isFinite(inst.capacity);
  const parts = [];

  for (let g = 0; g <= GRID; g += 20) {
    parts.push(svg("line", { x1: px(g), y1: px(0), x2: px(g), y2: px(GRID), class: "rr-gridline" }), svg("line", { x1: px(0), y1: px(g), x2: px(GRID), y2: px(g), class: "rr-gridline" }));
  }

  plan.forEach((route, t) => {
    if (!route.length) return;
    const pts = [0, ...route].map((id) => `${px(inst.nodes[id].x)},${px(inst.nodes[id].y)}`);
    const last = inst.nodes[route[route.length - 1]];
    const depot = inst.nodes[0];
    parts.push(
      svg("polyline", { points: pts.join(" "), class: "rr-leg", style: `stroke:${truckColor(t)}`, "stroke-dasharray": TRUCK_DASH[t % 3] }),
      svg("line", { x1: px(last.x), y1: px(last.y), x2: px(depot.x), y2: px(depot.y), class: "rr-leg rr-leg-home", style: `stroke:${truckColor(t)}`, "stroke-dasharray": TRUCK_DASH[t % 3] }),
    );
  });

  const depot = inst.nodes[0];
  parts.push(
    svg(
      "g",
      { class: "rr-depot", transform: `translate(${px(depot.x)},${px(depot.y)})` },
      svg("rect", { x: -13, y: -13, width: 26, height: 26, rx: 4 }),
      svg("path", { class: "rr-depot-icon", d: "M0,-8 L8,-1 L5.5,-1 L5.5,7 L1.8,7 L1.8,2 L-1.8,2 L-1.8,7 L-5.5,7 L-5.5,-1 L-8,-1 Z" }),
    ),
  );

  const findStop = (id) => {
    for (let t = 0; t < plan.length; t++) {
      const i = plan[t].indexOf(id);
      if (i >= 0) return { truck: t, stop: i };
    }
    return null;
  };

  inst.nodes.slice(1).forEach((c) => {
    const at = findStop(c.id);
    const attrs = { class: `rr-node${at ? " is-routed" : ""}`, transform: `translate(${px(c.x)},${px(c.y)})` };
    if (o.interactive) {
      const order = capacitated ? `, ${c.demand} box${c.demand === 1 ? "" : "es"}` : "";
      Object.assign(attrs, {
        tabindex: "0",
        role: "button",
        dataset: { key: `c-${c.id}` },
        "aria-label": at
          ? `Customer ${c.label}${order}, stop ${at.stop + 1} of truck ${at.truck + 1}. Press to remove.`
          : `Customer ${c.label}${order}, not on a route. Press to add to truck ${o.active + 1}.`,
        onclick: () => o.toggle(c.id),
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            o.toggle(c.id);
          }
        },
        onpointerenter: () => o.hover(c.id),
        onpointerleave: () => o.hover(null),
        onfocus: () => o.hover(c.id),
        onblur: () => o.hover(null),
      });
    }
    parts.push(
      svg(
        "g",
        attrs,
        svg("circle", { r: 20, class: "rr-hit" }),
        svg("circle", { r: 13, class: "rr-dot", style: at ? `stroke:${truckColor(at.truck)}` : null }),
        svg("text", { class: "rr-node-label", dy: "0.35em" }, c.label),
        at ? svg("g", { class: "rr-badge", transform: "translate(12,-12)" }, svg("circle", { r: 8 }), svg("text", { dy: "0.35em" }, String(at.stop + 1))) : null,
        capacitated ? svg("g", { class: "rr-demand", transform: "translate(13,13)" }, svg("rect", { x: -7, y: -7, width: 14, height: 14, rx: 3 }), svg("text", { dy: "0.35em" }, String(c.demand))) : null,
      ),
    );
  });

  return svg(
    "svg",
    {
      class: "rr-svg",
      viewBox: `0 0 ${S} ${S}`,
      role: o.interactive ? "group" : "img",
      "aria-label": o.interactive ? "Delivery map. Customers are buttons." : o.label,
    },
    parts,
  );
}

/** One line of words for a plan, used in figure captions and alt text. */
function planWords(inst, plan) {
  return plan.map((r, t) => `truck ${t + 1}: Depot → ${r.map((id) => inst.nodes[id].label).join(" → ")} → Depot`).join("; ");
}

function miniMap(inst, plan, title, length) {
  return h(
    "figure",
    { class: "rr-mini" },
    drawMap(inst, plan, { label: `${title}, ${km(length)}. ${planWords(inst, plan)}.` }),
    h("figcaption", {}, h("strong", {}, title), ` · ${km(length)}`),
  );
}

function showResults(ctx, inst, plan) {
  const { nodes, trucks } = inst;
  const capacitated = Number.isFinite(inst.capacity);
  const exact = inst.n <= EXACT_LIMIT;
  const you = evaluate(inst, plan);
  const nnPlan = nearestNeighbor(inst);
  const two = twoOpt(inst, nnPlan);
  const nn = evaluate(inst, nnPlan);
  const tw = evaluate(inst, two.plan);
  const best = exact ? optimalPlan(inst) : bestFound(inst, [plan, two.plan]);
  const bm = evaluate(inst, best.plan);
  const bestName = exact ? "optimum" : "best plan found";
  const BestCol = exact ? "Optimal" : "Best found";

  const g = gap(you.total, best.length);
  const stars = starsFor(you.total, best.length);
  const matched = g <= 1e-6;
  const label = (id) => (id === 0 ? "Depot" : nodes[id].label);
  const legText = (leg) => `${label(leg.from)} → ${label(leg.to)} (${km(leg.km)})`;
  const gapText = (x) => (gap(x, best.length) <= 1e-6 ? "0.0%" : `+${pct(gap(x, best.length))}`);

  const headline = matched
    ? exact
      ? `${km(you.total)}: the shortest possible plan`
      : `${km(you.total)}: as good as the best plan the computer found`
    : `${km(you.total)}: ${pct(g)} longer than the ${bestName} (${km(best.length)})`;

  const youCross = countCrossings(inst, plan);
  const nnLeg = longestLeg(inst, nnPlan);
  const bestLeg = longestLeg(inst, best.plan);
  const nnGap = gap(nn.total, best.length);
  const beatNN = you.total < nn.total - EPS;

  const debrief = [
    {
      title: "Heuristic versus optimal",
      body: `<p>A <b>heuristic</b> is a quick rule that gives a decent answer without checking every possibility. The <b>nearest-neighbor</b> rule says: from where you are, always drive to the closest customer you haven't visited${
        capacitated ? " whose order still fits" : ""
      }. Here it gave <b>${km(nn.total)}</b>, ${nnGap <= 1e-6 ? `which happens to match the ${bestName}` : `<b>${pct(nnGap)}</b> longer than the ${bestName} of ${km(best.length)}`}. ${
        beatNN ? "Your plan beat it." : you.total > nn.total + EPS ? "It beat your plan this time." : "Your plan tied with it."
      }</p><p>${
        exact
          ? `The optimum was found by checking every possibility in a smart order, which only works on small maps.`
          : `This map has ${inst.n} customers, more than the ${EXACT_LIMIT} this game solves exactly, so the last column is the best plan a computer search found. It is very good, but not proven to be the shortest.`
      }</p>`,
    },
    {
      title: "Why greedy fails",
      body: `<p>Nearest neighbor is <b>greedy</b>: it grabs the best next step and never looks ahead. The early legs are short, but customers left behind must be picked up later with long drives. Its longest leg here was <b>${legText(
        nnLeg,
      )}</b>; the ${bestName}'s longest leg is ${legText(bestLeg)}.</p><p><b>2-opt</b> repairs a route by reversing a stretch of it whenever that makes the route shorter, which is what untangles a crossing. ${
        two.swaps
          ? `It made ${two.swaps} such swap${two.swaps === 1 ? "" : "s"} on the nearest-neighbor plan and saved ${km(nn.total - tw.total)}.`
          : "It found nothing to fix in the nearest-neighbor plan this time."
      } ${
        youCross
          ? `Your plan has ${youCross} crossing${youCross === 1 ? "" : "s"}. A route that crosses itself can always be shortened by uncrossing it.`
          : "Your routes never cross themselves, which every shortest route has in common."
      }</p>${
        gap(tw.total, best.length) > 1e-6
          ? `<p>Even after 2-opt the plan is still ${pct(gap(tw.total, best.length))} above the ${bestName}. Fixing a route step by step can get stuck at a plan that looks good up close but isn't the best overall.</p>`
          : ""
      }`,
    },
  ];

  if (capacitated) {
    const single = singleTourLength(inst);
    debrief.push({
      title: "Capacity makes it harder",
      body: h(
        "div",
        {},
        h("p", { class: "g-formula" }, `trucks needed ≥ total boxes ÷ capacity = ${inst.totalDemand} ÷ ${inst.capacity} = ${fmt(inst.totalDemand / inst.capacity, 2)}, so at least ${minTrucks(inst)}`),
        h(
          "p",
          {
            html: `With a load limit you make two decisions at once: <b>which truck</b> serves each customer, and <b>in what order</b>. A customer that is close to a route may still not fit on that truck. If one truck could carry everything, ${
              single.exact ? "the shortest" : "a very good"
            } single trip would be ${km(single.length)}. With ${inst.capacity} boxes per truck the ${bestName} is ${km(best.length)}, so capacity costs about <b>${km(
              Math.max(0, best.length - single.length),
            )}</b> of extra driving back to the depot.`,
          },
        ),
      ),
    });
  }

  debrief.push({
    title: "How many plans are there?",
    body: `<p>With one truck and ${inst.n} customers there are ${inst.n}! ÷ 2 = <b>${tourCount(inst.n).toLocaleString("en-US")}</b> different round trips${
      trucks > 1 ? ", and splitting customers between trucks adds even more choices" : ""
    }. With 15 customers that number passes 650 billion, and every extra customer multiplies it again. This is the <b>traveling salesperson problem</b>${
      trucks > 1 ? " (with several trucks and capacity it is called the <b>vehicle routing problem</b>)" : ""
    }. Delivery companies with hundreds of stops can't check every plan, so they rely on good heuristics and improvement steps like 2-opt.</p>`,
  });

  ctx.finish({
    outcome: stars === 3 ? "win" : stars === 2 ? "ok" : "miss",
    stars,
    headline,
    summary: `Your ${plan.length === 1 ? "route is" : `${plan.length} routes are`} <b>${km(you.total)}</b> long in total. Three stars need a plan within ${pct(STAR_GAPS[0], 0)} of the ${bestName}; two stars within ${pct(STAR_GAPS[1], 0)}.`,
    comparison: {
      caption: `Your plan compared with two heuristics and the ${bestName}`,
      columns: ["You", "Nearest neighbor", "Nearest neighbor + 2-opt", BestCol],
      rows: [
        { label: "Total distance (km)", values: [you, nn, tw, bm].map((x) => fmt(x.total, 1)) },
        { label: `Above the ${exact ? "optimum" : "best found"}`, values: [you, nn, tw, bm].map((x) => gapText(x.total)) },
        ...(trucks > 1 ? [{ label: "Trucks used", values: [you, nn, tw, bm].map((x) => String(x.trucksUsed)) }] : []),
        { label: "Longest leg (km)", values: [plan, nnPlan, two.plan, best.plan].map((p) => fmt(longestLeg(inst, p).km, 1)) },
        { label: "Route crossings", values: [plan, nnPlan, two.plan, best.plan].map((p) => String(countCrossings(inst, p))) },
      ],
    },
    figure: h(
      "div",
      { class: "rr-compare" },
      miniMap(inst, plan, "Your plan", you.total),
      miniMap(inst, nnPlan, "Nearest neighbor", nn.total),
      miniMap(inst, best.plan, exact ? "Optimal plan" : "Best plan found", best.length),
    ),
    debrief,
  });
}
