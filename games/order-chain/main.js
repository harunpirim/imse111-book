// Order Chain: run one stage of a four-stage helmet supply chain, one order a
// week, and discover the bullwhip effect in the results.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt } from "../shared/dom.js";
import {
  ASSUMPTIONS,
  LEVELS,
  STAGES,
  N_STAGES,
  SHIP_DELAY,
  HOLD_COST,
  BACKORDER_COST,
  MAX_ORDER,
  NAIVE_ADJUST,
  NAIVE_PIPELINE,
  FORECAST_WEEKS,
  generateScenario,
  createChain,
  beginWeek,
  stageView,
  placeOrders,
  clampOrder,
  naivePolicy,
  runChain,
  allBaseStock,
  summarize,
  references,
  starsFor,
  usd,
} from "./logic.js";

// Who each stage deals with, in the player's words.
const ROLE = [
  { customer: "riders", supplier: "the wholesaler", does: "sells helmets to riders and orders from the wholesaler" },
  { customer: "the bike shop", supplier: "the distributor", does: "supplies the bike shop and orders from the distributor" },
  { customer: "the wholesaler", supplier: "the factory", does: "supplies the wholesaler and orders from the factory" },
  { customer: "the distributor", supplier: "your own production line", does: "supplies the distributor and decides how many helmets to make" },
];
const weeksText = (n) => `${n} week${n === 1 ? "" : "s"}`;
const f1 = (x) => fmt(x, 1);

function start(ctx) {
  const scn = generateScenario(ctx.rng, ctx.level);
  const state = createChain(scn);
  let seat = null; // solo: the player's stage; null in pass-and-play
  let team = false;
  let pending = []; // pass-and-play: orders collected so far this week

  ctx.setStatus(
    h(
      "p",
      { class: "oc-brief" },
      h("strong", {}, `${ctx.level.name}: `),
      `Prairie Helmets has sold a steady ${scn.base} helmets a week. ${scn.story} `,
      `You play ${scn.weeks} weeks. An order takes ${weeksText(scn.orderDelay)} to reach the supplier, and the shipment takes ${weeksText(scn.shipDelay)} more to arrive. `,
      `Each week, a helmet in stock costs ${usd(HOLD_COST)} and a helmet you owe costs ${usd(BACKORDER_COST)}.`,
    ),
  );

  // ------------------------------------------------------------ setup
  function showSetup() {
    replace(
      ctx.stage,
      h(
        "section",
        { class: "g-card oc-setup" },
        h("h2", { class: "oc-h" }, "Choose your seat"),
        chainStrip(null),
        h("p", { class: "oc-setup-lead" }, "You run one stage and place one order a week. Automated players run the other three. Nobody can see anyone else's stock or orders."),
        h(
          "div",
          { class: "oc-seats" },
          STAGES.map((st, i) =>
            h(
              "button",
              { type: "button", class: `oc-seat oc-s${i}`, dataset: { key: `seat-${i}` }, onclick: () => begin(i) },
              h("span", { class: "oc-seat-badge", "aria-hidden": "true" }, st.short),
              h("span", { class: "oc-seat-name" }, st.name),
              h("span", { class: "oc-seat-does" }, `${st.place}: ${ROLE[i].does}.`),
            ),
          ),
        ),
        h("h2", { class: "oc-h oc-h-gap" }, "Or play with friends"),
        h(
          "button",
          { type: "button", class: "oc-seat oc-seat-team", dataset: { key: "seat-team" }, onclick: () => begin(null) },
          h("span", { class: "oc-seat-badge", "aria-hidden": "true" }, "4"),
          h("span", { class: "oc-seat-name" }, "Pass-and-play, 4 players"),
          h("span", { class: "oc-seat-does" }, "Four people share this device, one per stage. Each sees only their own screen; the others look away while the device is passed."),
        ),
      ),
    );
  }

  function begin(chosen) {
    team = chosen === null;
    seat = chosen;
    nextWeek();
  }

  // ------------------------------------------------------------ one week
  function nextWeek() {
    if (state.phase === "done") return finish();
    beginWeek(state);
    pending = [];
    if (team) showCover(0);
    else showTurn(seat);
  }

  function submitOrder(i, qty) {
    const q = clampOrder(qty);
    if (team) {
      pending[i] = q;
      if (i + 1 < N_STAGES) return showCover(i + 1);
      placeOrders(state, pending);
    } else {
      // The other three seats use the automated rule, on their own information only.
      placeOrders(
        state,
        STAGES.map((_, k) => (k === i ? q : naivePolicy(stageView(state, k)))),
      );
    }
    nextWeek();
  }

  function showCover(i) {
    const st = STAGES[i];
    replace(
      ctx.stage,
      h(
        "section",
        { class: "g-card oc-cover" },
        h("p", { class: "oc-cover-week" }, `Week ${state.week + 1} of ${scn.weeks}`),
        h("h2", { class: "oc-cover-title", tabindex: "-1" }, `Pass the device to the ${st.name}`),
        h("p", {}, "Everyone else: look away until it is your turn."),
        h("button", { type: "button", class: `g-btn g-btn-primary g-btn-lg oc-cover-go`, dataset: { key: "cover-go" }, onclick: () => showTurn(i) }, `I am the ${st.name}: show my screen`),
      ),
    );
    ctx.stage.querySelector("[data-key=cover-go]")?.focus({ preventScroll: true });
    ctx.announce(`Week ${state.week + 1}. Pass the device to the ${st.name}.`);
  }

  function showTurn(i) {
    const v = stageView(state, i);
    const st = STAGES[i];
    const role = ROLE[i];
    const weekCost = HOLD_COST * v.inv + BACKORDER_COST * v.backlog;
    let qty = clampOrder(v.lastOrder);

    const input = h("input", {
      class: "oc-qty",
      type: "number",
      inputmode: "numeric",
      min: "0",
      max: String(MAX_ORDER),
      step: "1",
      value: String(qty),
      id: "oc-qty",
      "aria-describedby": "oc-qty-help",
      dataset: { key: "qty" },
      oninput: (e) => {
        qty = clampOrder(Number(e.target.value));
      },
      onkeydown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitOrder(i, qty);
        }
      },
    });
    const setQty = (q) => {
      qty = clampOrder(q);
      input.value = String(qty);
      input.focus({ preventScroll: true });
    };
    const quick = (label, q) => h("button", { type: "button", class: "oc-quick", onclick: () => setQty(q) }, `${label} (${q})`);

    const metric = (label, value, state2, hint) =>
      h("div", { class: "g-metric", dataset: state2 ? { state: state2 } : {} }, h("span", { class: "g-metric-label" }, label), h("span", { class: "g-metric-value" }, value), hint ? h("span", { class: "oc-metric-hint" }, hint) : null);

    replace(
      ctx.stage,
      h(
        "div",
        { class: "oc-weekbar" },
        h("h2", { class: "oc-week", tabindex: "-1" }, `Week ${v.week} of ${v.weeks}`, h("span", { class: `oc-you oc-s${i}` }, ` · ${st.name}`)),
        h("div", { class: "oc-progress", role: "img", "aria-label": `Week ${v.week} of ${v.weeks}` }, h("span", { style: `width:${(100 * (v.week - 1)) / v.weeks}%` })),
      ),
      chainStrip(i),
      h(
        "div",
        { class: "g-metrics oc-metrics", "aria-label": "This week at your stage" },
        metric(`Arrived from ${i === N_STAGES - 1 ? "production" : "your supplier"}`, String(v.arrived)),
        metric(`Ordered by ${role.customer}`, String(v.incoming)),
        metric("You shipped", String(v.shipped)),
        metric("In stock now", String(v.inv), v.backlog ? null : v.inv === 0 ? "warn" : null, `${usd(HOLD_COST)} each per week`),
        metric("Backlog (owed)", String(v.backlog), v.backlog ? "bad" : null, `${usd(BACKORDER_COST)} each per week`),
        metric("Cost this week", usd(weekCost)),
        metric("Your cost so far", usd(v.costSoFar + weekCost)),
      ),
      h(
        "section",
        { class: "g-card oc-order", "aria-label": "Place your order" },
        h("label", { class: "oc-order-label", for: "oc-qty" }, i === N_STAGES - 1 ? "How many helmets do you start making this week?" : `How many helmets do you order from ${role.supplier} this week?`),
        h(
          "div",
          { class: "oc-order-row" },
          h("button", { type: "button", class: "g-btn oc-step", "aria-label": "One fewer", onclick: () => setQty(qty - 1) }, "−"),
          input,
          h("button", { type: "button", class: "g-btn oc-step", "aria-label": "One more", onclick: () => setQty(qty + 1) }, "+"),
          h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg oc-place", dataset: { key: "place" }, onclick: () => submitOrder(i, qty) }, "Place order"),
        ),
        h("div", { class: "oc-quicks" }, quick("Same as last week", v.lastOrder), quick("Match this week's order", v.incoming), quick("Order nothing", 0)),
        h(
          "p",
          { class: "oc-help", id: "oc-qty-help" },
          `Whole helmets, 0 to ${MAX_ORDER}. It arrives in ${weeksText(v.leadTime)} if your supplier has stock, and it can't be cancelled. Press `,
          h("kbd", {}, "Enter"),
          " to place the order.",
        ),
      ),
      h(
        "div",
        { class: "oc-own" },
        h("section", { class: "g-card oc-own-chart", "aria-label": "Your record so far, as a chart" }, h("h3", { class: "oc-h" }, "Your record so far"), ownChart(v)),
        h("section", { class: "g-card oc-own-table", "aria-label": "Your record so far, as a table" }, h("h3", { class: "oc-h" }, "Your last weeks"), ownTable(v)),
      ),
    );
    input.focus({ preventScroll: true });
    input.select();
    ctx.announce(
      `Week ${v.week}. ${v.arrived} arrived. ${role.customer} ordered ${v.incoming}. You shipped ${v.shipped}. Stock ${v.inv}, backlog ${v.backlog}.`,
    );
  }

  // ------------------------------------------------------------ results
  function finish() {
    const mine = summarize(state);
    const refs = references(scn, team ? null : seat);
    const sharedState = runChain(scn, allBaseStock());
    const stars = starsFor(mine.teamCost, refs, !team);
    const cols = team ? [mine, refs.naive, refs.shared] : [mine, refs.naive, refs.steady, refs.shared];
    const names = team ? ["Your team", "All four automated", "Shared information"] : ["Your team", "Autopilot in your seat", "Steady hand in your seat", "Shared information"];
    const row = (label, fn) => ({ label, values: cols.map(fn) });
    const last = N_STAGES - 1;
    const who = team ? "Your team" : `You (${STAGES[seat].name}) and three automated players`;

    const headline =
      stars === 3
        ? team
          ? `Team cost ${usd(mine.teamCost)}: a calm chain`
          : `Team cost ${usd(mine.teamCost)}: a steady hand in the ${STAGES[seat].name}'s seat`
        : stars === 2
          ? `Team cost ${usd(mine.teamCost)}: better than the autopilot`
          : `Team cost ${usd(mine.teamCost)}: the bullwhip got you`;

    const maxOrder = Math.max(...mine.stages.map((s) => s.orderMax), ...refs.shared.stages.map((s) => s.orderMax), scn.after, scn.base);
    const orderSeries = (st) => st.history.map((hst, i) => ({ name: STAGES[i].name, short: STAGES[i].short, values: hst.order, cls: `oc-s${i}` }));
    const netSeries = (st) => st.history.map((hst, i) => ({ name: STAGES[i].name, short: STAGES[i].short, values: hst.inv.map((x, t) => x - hst.backlog[t]), cls: `oc-s${i}` }));
    const nets = [...netSeries(state), ...netSeries(sharedState)].flatMap((s) => s.values);
    const netRange = [Math.min(0, ...nets), Math.max(...nets)];

    ctx.finish({
      outcome: stars === 3 ? "win" : stars === 2 ? "ok" : "miss",
      stars,
      headline,
      summary: `${who} ran the chain for ${scn.weeks} weeks at a total cost of <b>${usd(mine.teamCost)}</b>. Customer demand changed only once: from ${scn.base} to ${scn.after} helmets a week in week ${scn.stepWeek}. Yet the factory's orders ranged from <b>${mine.stages[last].orderMin} to ${mine.stages[last].orderMax}</b> a week. ${
        refs.shared.teamCost < mine.teamCost
          ? `With shared demand information, the same chain costs ${usd(refs.shared.teamCost)}.`
          : `That beats the shared-information benchmark (${usd(refs.shared.teamCost)}) on cost, although the benchmark's orders swing less.`
      }`,
      comparison: {
        caption: team
          ? "Your team, the chain with all four stages automated, and the benchmark with shared demand information"
          : "Your team, the same chain with the automated rule in your seat, the best steady rule in your seat, and the benchmark with shared demand information",
        columns: names,
        rows: [
          row("Team cost", (c) => usd(c.teamCost)),
          ...STAGES.map((st, i) => row(`${st.name}${!team && i === seat ? " (you)" : ""}`, (c) => usd(c.stages[i].cost))),
          row("Largest weekly order", (c) => String(Math.max(...c.stages.map((s) => s.orderMax)))),
          row("Largest backlog", (c) => String(Math.max(...c.stages.map((s) => s.peakBacklog)))),
          row("Bullwhip at the factory", (c) => `${f1(c.stages[last].bullwhip)}×`),
        ],
      },
      figure: h(
        "div",
        { class: "oc-figs" },
        lineChart({ title: "Orders placed each week: your game", series: orderSeries(state), demand: scn.demand, yMin: 0, yMax: maxOrder, unit: "helmets ordered" }),
        lineChart({ title: "Orders placed each week: shared information", series: orderSeries(sharedState), demand: scn.demand, yMin: 0, yMax: maxOrder, unit: "helmets ordered" }),
        lineChart({ title: "Stock minus backlog: your game", series: netSeries(state), yMin: netRange[0], yMax: netRange[1], unit: "helmets (below 0 = owed)", zero: true }),
        lineChart({ title: "Stock minus backlog: shared information", series: netSeries(sharedState), yMin: netRange[0], yMax: netRange[1], unit: "helmets (below 0 = owed)", zero: true }),
        bullwhipChart(mine, refs.shared),
        legend(),
      ),
      debrief: debrief(scn, mine, refs, team, seat),
    });
  }

  showSetup();
}

// ---------------------------------------------------------------- pieces

/** The chain as a strip: helmets flow toward the customers, orders flow toward the factory. */
function chainStrip(you) {
  const cells = [h("span", { class: "oc-node oc-node-cust" }, "Riders")];
  STAGES.forEach((st, i) => {
    cells.push(h("span", { class: "oc-link", "aria-hidden": "true" }, h("span", { class: "oc-link-goods" }, "◀ helmets"), h("span", { class: "oc-link-orders" }, "orders ▶")));
    cells.push(
      h(
        "span",
        { class: `oc-node oc-s${i}${you === i ? " is-you" : ""}` },
        h("span", { class: "oc-node-badge", "aria-hidden": "true" }, st.short),
        st.name,
        you === i ? h("span", { class: "oc-node-you" }, "you") : you != null ? h("span", { class: "oc-node-hidden" }, "hidden") : null,
      ),
    );
  });
  return h(
    "div",
    { class: "oc-strip", role: "img", "aria-label": `The chain: riders buy from the retailer, who orders from the wholesaler, who orders from the distributor, who orders from the factory.${you != null ? ` You are the ${STAGES[you].name}.` : ""}` },
    cells,
  );
}

function ownTable(v) {
  const hst = v.history;
  const n = hst.order.length;
  if (!n) return h("p", { class: "oc-empty" }, "Your past weeks will be listed here.");
  const rows = [];
  for (let t = n - 1; t >= Math.max(0, n - 8); t--) {
    rows.push(
      h(
        "tr",
        {},
        h("th", { scope: "row" }, String(t + 1)),
        h("td", {}, String(hst.incoming[t])),
        h("td", {}, String(hst.arrived[t])),
        h("td", {}, String(hst.inv[t])),
        h("td", { class: hst.backlog[t] ? "oc-bad" : null }, String(hst.backlog[t])),
        h("td", { class: "g-you" }, String(hst.order[t])),
      ),
    );
  }
  return h(
    "div",
    { class: "g-table-wrap" },
    h(
      "table",
      { class: "g-table oc-table" },
      h("thead", {}, h("tr", {}, ["Week", "Order in", "Arrived", "Stock", "Backlog", "Your order"].map((c, k) => h("th", { scope: "col", class: k === 5 ? "g-you" : null }, c)))),
      h("tbody", {}, rows),
    ),
  );
}

/** The player's own numbers so far: orders received, orders placed, and stock minus backlog. */
function ownChart(v) {
  const hst = v.history;
  if (!hst.order.length) return h("p", { class: "oc-empty" }, "Your chart starts after your first order.");
  const net = hst.inv.map((x, t) => x - hst.backlog[t]);
  return lineChart({
    title: null,
    weeks: v.weeks,
    series: [
      { name: "Ordered from you", short: "in", values: hst.incoming, cls: "oc-own-in" },
      { name: "You ordered", short: "you", values: hst.order, cls: "oc-own-out" },
      { name: "Stock minus backlog", short: "stock", values: net, cls: "oc-own-net" },
    ],
    yMin: Math.min(0, ...net),
    yMax: Math.max(...net, ...hst.order, ...hst.incoming, 10),
    unit: "helmets",
    zero: true,
    compact: true,
    ownLegend: true,
  });
}

function niceTicks(lo, hi, count = 4) {
  const span = Math.max(1, hi - lo);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(Math.round(t));
  return ticks;
}

/**
 * A small line chart of weekly values. Each series has its own color, dash
 * pattern, and a letter at its right end, so color is never the only signal.
 */
function lineChart({ title, series, demand, weeks, yMin, yMax, unit, zero, compact, ownLegend }) {
  const n = weeks || series[0].values.length;
  const W = 340;
  const H = compact ? 170 : 200;
  const m = { l: 34, r: compact ? 44 : 22, t: 10, b: 24 };
  const lo = Math.min(yMin, 0);
  const hi = Math.max(yMax, lo + 1) * 1.06;
  const x = (t) => m.l + ((W - m.l - m.r) * t) / Math.max(1, n - 1);
  const y = (val) => m.t + (H - m.t - m.b) * (1 - (val - lo) / (hi - lo));
  const els = [];
  niceTicks(lo, hi).forEach((t) => {
    els.push(svg("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 && zero ? "oc-zero" : "oc-grid" }), svg("text", { x: m.l - 5, y: y(t) + 3.5, class: "oc-tick oc-tick-y" }, String(t)));
  });
  for (let w = 5; w <= n; w += 5) els.push(svg("text", { x: x(w - 1), y: H - 8, class: "oc-tick" }, String(w)));
  els.push(svg("text", { x: m.l - 5, y: H - 8, class: "oc-tick oc-axis-name" }, "week"));
  const path = (vals) => vals.map((val, t) => `${t ? "L" : "M"}${fmt(x(t), 1)},${fmt(y(val), 1)}`).join(" ");
  if (demand) els.push(svg("path", { d: path(demand), class: "oc-line oc-demand" }));
  series.forEach((s) => {
    els.push(svg("path", { d: path(s.values), class: `oc-line ${s.cls}` }));
  });
  // Letters at the right end of each line, nudged apart so they don't overlap.
  const ends = series
    .filter((s) => s.values.length)
    .map((s) => ({ s, y: y(s.values[s.values.length - 1]), x: x(s.values.length - 1) }))
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 11) ends[k].y = ends[k - 1].y + 11;
  ends.forEach((e) => els.push(svg("text", { x: e.x + 4, y: e.y + 4, class: `oc-end ${e.s.cls}` }, e.s.short)));

  const describe = series.map((s) => `${s.name} from ${Math.min(...s.values)} to ${Math.max(...s.values)}`).join("; ");
  return h(
    "figure",
    { class: `oc-chart${compact ? " oc-chart-compact" : ""}` },
    title ? h("figcaption", { class: "oc-chart-title" }, title) : null,
    svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${title || "Your record"}, in ${unit}. ${describe}.${demand ? ` Customer demand from ${Math.min(...demand)} to ${Math.max(...demand)}.` : ""}` }, els),
    ownLegend ? h("p", { class: "oc-legend oc-legend-own" }, series.map((s) => legendKey(s.cls, `${s.short} = ${s.name.toLowerCase()}`))) : null,
  );
}

function legendKey(cls, label) {
  return h("span", { class: "oc-key" }, svg("svg", { viewBox: "0 0 26 8", class: "oc-key-line", "aria-hidden": "true" }, svg("path", { d: "M1,4 L25,4", class: `oc-line ${cls}` })), label);
}

function legend() {
  return h("p", { class: "oc-legend" }, legendKey("oc-demand", "Customer demand"), STAGES.map((st, i) => legendKey(`oc-s${i}`, `${st.short} = ${st.name}`)));
}

/** Bars: variance of each stage's orders divided by the variance of customer demand. */
function bullwhipChart(mine, shared) {
  const W = 340;
  const rowH = 38;
  const left = 78;
  const H = N_STAGES * rowH + 20;
  const max = Math.max(1, ...mine.stages.map((s) => s.bullwhip), ...shared.stages.map((s) => s.bullwhip));
  const bw = (val) => Math.max(1.5, ((W - left - 46) * val) / max);
  const els = [];
  STAGES.forEach((st, i) => {
    const y0 = 4 + i * rowH;
    const a = mine.stages[i].bullwhip;
    const b = shared.stages[i].bullwhip;
    els.push(
      svg("text", { x: 0, y: y0 + 19, class: "oc-bw-name" }, st.name),
      svg("rect", { x: left, y: y0 + 2, width: bw(a), height: 13, class: `oc-bw-bar oc-s${i}` }),
      svg("text", { x: left + bw(a) + 4, y: y0 + 13, class: "oc-bw-val" }, `${f1(a)}×`),
      svg("rect", { x: left, y: y0 + 18, width: bw(b), height: 9, class: "oc-bw-bar oc-bw-shared" }),
      svg("text", { x: left + bw(b) + 4, y: y0 + 26.5, class: "oc-bw-val oc-bw-val-s" }, `${f1(b)}× shared`),
    );
  });
  const one = left + bw(1);
  els.push(svg("line", { x1: one, x2: one, y1: 0, y2: H - 16, class: "oc-bw-one" }), svg("text", { x: one, y: H - 4, class: "oc-tick" }, "1× = customers"));
  return h(
    "figure",
    { class: "oc-chart" },
    h("figcaption", { class: "oc-chart-title" }, "Bullwhip: how much more orders swing than customer demand"),
    svg(
      "svg",
      {
        viewBox: `0 0 ${W} ${H}`,
        role: "img",
        "aria-label": `Bullwhip by stage, your game then shared information. ${STAGES.map((st, i) => `${st.name}: ${f1(mine.stages[i].bullwhip)} times, ${f1(shared.stages[i].bullwhip)} times`).join(". ")}.`,
      },
      els,
    ),
  );
}

function debrief(scn, mine, refs, team, seat) {
  const last = N_STAGES - 1;
  const ranges = STAGES.map((st, i) => `<tr><th scope="row">${st.name}</th><td>${mine.stages[i].orderMin} to ${mine.stages[i].orderMax}</td><td>${f1(mine.stages[i].bullwhip)}×</td><td>${f1(refs.shared.stages[i].bullwhip)}×</td></tr>`).join("");
  const chainDelay = (N_STAGES - 1) * scn.orderDelay;
  const sections = [
    {
      title: "The bullwhip effect",
      body: `<p>Riders changed their buying once, by ${Math.abs(scn.after - scn.base)} helmets a week. As that small change moved up the chain it grew at every stage, like the tip of a whip moving much farther than the hand. That growth in order swings is the <b>bullwhip effect</b>.</p>
        <div class="g-table-wrap"><table class="g-table oc-mini"><caption>Bullwhip = variance of a stage's orders ÷ variance of customer demand. 1× means no amplification.</caption>
        <thead><tr><th scope="col"></th><th scope="col">Weekly orders</th><th scope="col">Bullwhip, your game</th><th scope="col">Bullwhip, shared information</th></tr></thead>
        <tbody><tr><th scope="row">Riders (demand)</th><td>${mine.demandMin} to ${mine.demandMax}</td><td>1.0×</td><td>1.0×</td></tr>${ranges}</tbody></table></div>`,
    },
    {
      title: "Why it happens",
      body: `<ul class="oc-deb-list">
        <li><b>Delays.</b> An order needs ${weeksText(scn.leadTime)} to come back as helmets (${weeksText(scn.orderDelay)} for the order, ${weeksText(scn.shipDelay)} for the shipment). The factory first hears of the change ${weeksText(chainDelay)} after the bike shop does. While you wait, stock keeps falling and it is tempting to order again.</li>
        <li><b>Local information.</b> Each stage sees only the orders of the stage below it, not what riders buy. A big order looks like a jump in demand, even when it is just someone refilling their shelves.</li>
        <li><b>Overreaction.</b> Ordering for the shortage you see today, and forgetting what is already on its way, orders the same shortage two or three times. When it all arrives, stock piles up and orders drop to zero. The automated players do exactly this: they count only ${NAIVE_PIPELINE * 100}% of what they have on order.</li>
      </ul>`,
    },
    {
      title: "What tames it",
      body: `<p><b>Share demand information.</b> In the benchmark every stage sees what riders really buy, forecasts it as the average of the last ${FORECAST_WEEKS} weeks, and orders up to a target: enough to cover the ${weeksText(scn.leadTime)} of delay plus its starting stock, <b>counting everything already on order</b>. This is a <b>base-stock</b> (order-up-to) policy. On the same demand it costs ${usd(refs.shared.teamCost)} against your team's ${usd(mine.teamCost)}, and the factory's bullwhip is ${f1(refs.shared.stages[last].bullwhip)}× against your game's ${f1(mine.stages[last].bullwhip)}×. It is a benchmark, not the best possible plan: a team that also shared stock levels could do better still.</p>
        <p>${scn.shipDelay > SHIP_DELAY ? `Shorter delays help too: this level's shipments took ${weeksText(scn.shipDelay)}. Compare it with "Trail opens", where they take ${weeksText(SHIP_DELAY)}.` : `Shorter delays help too: try the "Slow boat" level, where every shipment takes one week longer.`} Real supply chains share point-of-sale data, shorten lead times, and order in smaller, more regular amounts for exactly this reason.</p>`,
    },
  ];
  if (!team) {
    const st = STAGES[seat];
    const gain = refs.naive.teamCost - Math.min(refs.steady.teamCost, refs.naive.teamCost);
    sections.push({
      title: `What one seat can do`,
      body: `<p>You could not see or control the other three stages. With the automated rule in the ${st.name}'s seat, the team's cost is ${usd(refs.naive.teamCost)}. The best steady rule we could find for that seat (smooth the incoming orders, close ${fmt(refs.steady.adjust * 100, 0)}% of the gap each week, and count everything on order) brings it to ${usd(refs.steady.teamCost)}, a saving of ${usd(gain)}. Your team's cost was ${usd(mine.teamCost)}.</p>
        <p>Seats near the customer have the most leverage: a calm retailer sends calm orders to everyone upstream. The factory can only soften swings that are already on their way. The automated players order what was just ordered from them plus ${NAIVE_ADJUST * 100}% of their stock gap.</p>`,
    });
  } else {
    sections.push({
      title: "Talk it over",
      body: `<p>Compare notes now that the game is over. When did each of you first notice the change? Who ordered the most, and why? With all four seats automated the team's cost is ${usd(refs.naive.teamCost)}; yours was ${usd(mine.teamCost)}. What one piece of information would have helped most?</p>`,
    });
  }
  return sections;
}

// Start last, so every helper above exists even when ?autostart=1 begins a round at once.
createGame({
  slug: "order-chain",
  title: "Order Chain",
  tagline: "One small change in demand. Four stages. What could go wrong?",
  objective:
    "explain how delays and local information turn a small change in demand into large order swings (the bullwhip effect), and how sharing demand information reduces them.",
  minutes: "10-20",
  chapter: { href: "../../chapters/week-09.html", label: "Week 9 · Supply Chains, Logistics, and Facilities" },
  howToPlay: [
    "Helmets flow from the <b>factory</b> to the <b>distributor</b>, the <b>wholesaler</b>, the <b>retailer</b>, and then to riders. Orders flow the other way.",
    "Pick one stage. Each week you see what arrived, what was ordered from you, your stock, and your backlog. Then you place <b>one order</b>.",
    "Orders and shipments are slow: what you order today arrives weeks later. Stock costs money, and helmets you owe cost more.",
    "Automated players run the other three stages, or choose <b>pass-and-play</b> and let four people take turns on one device.",
    "After the last week you'll see everyone's orders and stock, the team's cost, and the same weeks played with shared information.",
    "Keyboard: type a number and press <kbd>Enter</kbd>. The arrow keys change the number by one.",
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start,
});
