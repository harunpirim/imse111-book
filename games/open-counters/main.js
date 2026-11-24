// Open Counters: decide how many counters a service desk opens each hour,
// watch one simulated day, then compare with the Erlang C staffing plan.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt, pct } from "../shared/dom.js";
import {
  ASSUMPTIONS,
  LEVELS,
  PERIOD_MIN,
  REPLICATIONS,
  STAR_RATIOS,
  generateDay,
  createSim,
  simulate,
  replicate,
  utilization,
  mmc,
  hourlyCost,
  minCounters,
  formulaPlan,
  leanPlan,
  tightestPeriod,
  starsFor,
  clock,
} from "./logic.js";

const SPEEDS = [
  { id: "1", label: "1×", minPerSec: 12 }, // one simulated hour in 5 seconds
  { id: "3", label: "3×", minPerSec: 36 },
  { id: "8", label: "8×", minPerSec: 96 },
];
const QUEUE_SHOW = 36; // people drawn in the line before "+N more"
const LONG_WAIT = 10; // minutes in line after which a person is marked "!"
let speed = "1"; // remembered across rounds

const money = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const mins = (v) => (Number.isFinite(v) ? `${fmt(v, 1)} min` : "no limit");
const hourLabel = (day, p) => `${day.openHour + p}:00–${day.openHour + p + 1}:00`;

createGame({
  slug: "open-counters",
  title: "Open Counters",
  tagline: "Too few counters and the line explodes. Too many and you pay people to wait for customers.",
  objective:
    "relate utilization to waiting time in a queue, explain why waits grow so fast near 100% utilization, and balance the cost of staff against the cost of waiting.",
  minutes: "10-20",
  chapter: { href: "../../chapters/week-10.html", label: "Week 10 · Modeling, Optimization, and Simulation" },
  howToPlay: [
    "You run a service desk. The table shows how many customers are expected each hour and how fast one counter serves.",
    "Use <b>−</b> and <b>+</b> to set how many counters are open each hour. The table shows the <b>utilization</b> you are planning: the share of counter time that arriving work will need.",
    "Press <b>Open the desk</b> to watch one random day. Customers arrive, wait in one line, and go to the first free counter. You can still change hours that haven't started.",
    "You pay for every open counter and for every minute a customer stands in line. Keep the <b>total cost</b> low.",
    "<kbd>P</kbd> pauses. <b>Skip to the end</b> finishes the day at once.",
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start,
});

function start(ctx) {
  const day = generateDay(ctx.rng, ctx.level);
  const { periods, rates, mu } = day;
  const close = periods * PERIOD_MIN;
  // Start one counter short of keeping up, so the first move is the player's.
  const plan = rates.map((r) => Math.max(1, minCounters(r, mu) - 1));
  const sim = createSim(day, plan);
  let running = false;
  let paused = false;
  let ended = false;
  let simT = 0;
  let frame = null;
  let lastStamp = null;
  let endTimer = null;
  let lastChart = -1;
  let lastQueueKey = "";
  let lastPeriod = -1;

  ctx.setStatus(
    h(
      "p",
      { class: "oc-brief" },
      h("strong", {}, `${day.desk}: `),
      `one counter serves about ${mu} customers per hour (${fmt(60 / mu, 0)} minutes each on average). `,
      `An open counter costs ${money(day.staffCost)} per hour. Each hour a ${day.customer} spends in line costs ${money(day.waitCost)}.`,
    ),
  );

  // ---- controls
  const startBtn = h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: begin }, "▶ Open the desk");
  const pauseBtn = h("button", { type: "button", class: "g-btn", onclick: togglePause, disabled: true }, "Pause");
  const skipBtn = h("button", { type: "button", class: "g-btn", onclick: skip }, "Skip to the end");
  const speedGroup = h(
    "div",
    { class: "oc-speed", role: "radiogroup", "aria-label": "Speed" },
    h("span", { class: "oc-speed-label" }, "Speed"),
    SPEEDS.map((s) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          class: "oc-speed-btn",
          "aria-checked": String(s.id === speed),
          "aria-label": `Speed ${s.label}`,
          onclick: (e) => {
            speed = s.id;
            speedGroup.querySelectorAll("[role=radio]").forEach((b) => b.setAttribute("aria-checked", String(b === e.currentTarget)));
          },
        },
        s.label,
      ),
    ),
  );

  // ---- live tiles
  const tile = (label) => {
    const value = h("span", { class: "g-metric-value" }, "–");
    const el = h("div", { class: "g-metric" }, h("span", { class: "g-metric-label" }, label), value);
    return { el, value };
  };
  const tiles = { clock: tile("Clock"), wait: tile("Average wait so far"), line: tile("In line now"), util: tile("Utilization so far"), cost: tile("Cost so far") };
  const costSub = h("span", { class: "oc-metric-sub" });
  tiles.cost.el.append(costSub);

  // ---- scene
  const counterEls = Array.from({ length: day.maxCounters }, (_, i) => {
    const who = h("span", { class: "oc-counter-who", "aria-hidden": "true" });
    const state = h("span", { class: "oc-counter-state" }, "closed");
    const el = h("div", { class: "oc-counter", dataset: { state: "closed" } }, h("span", { class: "oc-counter-num" }, String(i + 1)), who, state);
    return { el, state };
  });
  const queueEl = h("div", { class: "oc-queue", "aria-hidden": "true" });
  const queueLabel = h("p", { class: "oc-queue-label" });
  const chartEl = h("div", { class: "oc-chart" });
  const sceneSummary = h("p", { class: "g-sr-only", role: "status", "aria-live": "polite" });

  // ---- plan table
  const rows = rates.map((rate, p) => {
    const count = h("output", { class: "oc-count", "aria-live": "off" });
    const utilEl = h("td", { class: "oc-util" });
    const minus = h("button", { type: "button", class: "oc-step", "aria-label": `One counter fewer, ${hourLabel(day, p)}`, onclick: () => change(p, -1) }, "−");
    const plus = h("button", { type: "button", class: "oc-step", "aria-label": `One counter more, ${hourLabel(day, p)}`, onclick: () => change(p, 1) }, "+");
    const tr = h(
      "tr",
      { class: "oc-row" },
      h("th", { scope: "row" }, hourLabel(day, p)),
      h("td", { class: "oc-rate" }, h("span", { class: "oc-rate-num" }, String(rate)), h("span", { class: "oc-rate-bar", "aria-hidden": "true" }, h("span", { style: `width:${(100 * rate) / Math.max(...rates)}%` }))),
      h("td", { class: "oc-stepper" }, minus, count, plus),
      utilEl,
    );
    return { tr, count, utilEl, minus, plus };
  });
  const planFoot = h("p", { class: "oc-plan-foot" });

  replace(
    ctx.stage,
    h("div", { class: "oc-controls" }, startBtn, pauseBtn, skipBtn, speedGroup),
    h("div", { class: "g-metrics oc-metrics" }, Object.values(tiles).map((t) => t.el)),
    h(
      "div",
      { class: "oc-grid" },
      h(
        "section",
        { class: "g-card oc-scene", "aria-label": "The service desk" },
        h("h2", { class: "oc-h" }, "Counters"),
        h("div", { class: "oc-counters" }, counterEls.map((c) => c.el)),
        h("h2", { class: "oc-h" }, "Line"),
        queueEl,
        queueLabel,
        h("h2", { class: "oc-h" }, "Line length over the day"),
        chartEl,
        sceneSummary,
      ),
      h(
        "section",
        { class: "g-card oc-plan", "aria-label": "Staffing plan" },
        h("h2", { class: "oc-h" }, "Your staffing plan"),
        h(
          "table",
          { class: "oc-table" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Hour"), h("th", { scope: "col" }, "Arrivals per hour"), h("th", { scope: "col" }, "Counters open"), h("th", { scope: "col" }, "Utilization"))),
          h("tbody", {}, rows.map((r) => r.tr)),
        ),
        planFoot,
        h("p", { class: "oc-formula-note" }, h("span", { class: "g-formula oc-inline" }, `utilization = arrivals per hour ÷ (counters × ${mu})`)),
      ),
    ),
  );

  function change(p, d) {
    const st = sim.state();
    if (ended || (running && p <= st.period)) return;
    const next = plan[p] + d;
    if (next < 1 || next > day.maxCounters) return;
    plan[p] = next;
    renderPlan();
    if (!running) drawScene();
    ctx.announce(`${hourLabel(day, p)}: ${next} counter${next === 1 ? "" : "s"}, utilization ${pct(utilization(rates[p], mu, next), 0)}.`);
  }

  function renderPlan() {
    const st = sim.state();
    rows.forEach((r, p) => {
      const c = plan[p];
      const u = utilization(rates[p], mu, c);
      const locked = ended || (running && p <= st.period);
      r.count.textContent = String(c);
      r.minus.disabled = locked || c <= 1;
      r.plus.disabled = locked || c >= day.maxCounters;
      r.tr.classList.toggle("is-current", running && !ended && p === st.period && st.t < close);
      r.tr.classList.toggle("is-past", running && (p < st.period || st.t >= close));
      replace(r.utilEl, h("span", { class: "oc-util-num" }, pct(u, 0)), u >= 1 ? h("span", { class: "oc-flag" }, "✖ over 100%: the line keeps growing") : null);
      r.utilEl.dataset.state = u >= 1 ? "bad" : "";
    });
    const hours = plan.reduce((a, b) => a + b, 0);
    planFoot.textContent = `Planned: ${hours} counter-hours = ${money(hours * day.staffCost)} in staff cost for the day.`;
    drawChart(true);
  }

  function drawScene() {
    const st = sim.state();
    tiles.clock.value.textContent = clock(day, st.t);
    tiles.wait.value.textContent = st.arrived ? mins(st.avgWait) : "–";
    tiles.line.value.textContent = String(st.queue.length);
    tiles.line.el.dataset.state = st.queue.length >= 15 ? "bad" : st.queue.length >= 6 ? "warn" : "";
    tiles.util.value.textContent = st.t > 0 ? pct(st.utilization, 0) : "–";
    tiles.cost.value.textContent = money(st.staffCost + st.waitCost);
    costSub.textContent = `staff ${money(st.staffCost)} + waiting ${money(st.waitCost)}`;

    counterEls.forEach((c, i) => {
      const busy = st.slots[i] >= 0;
      const open = running && !st.finished && (st.t < close ? i < st.open : busy);
      const state = !running ? (i < plan[0] ? "ready" : "closed") : busy ? (i < st.open || st.t >= close ? "busy" : "closing") : open ? "idle" : "closed";
      if (c.el.dataset.state !== state) {
        c.el.dataset.state = state;
        c.state.textContent = { ready: "opens first", closed: "closed", idle: "free", busy: "serving", closing: "closing" }[state];
      }
    });

    const longWaiters = st.queue.filter((i) => st.t - day.arrivals[i] > LONG_WAIT).length;
    const key = `${st.queue.length}:${longWaiters}`;
    if (key !== lastQueueKey) {
      lastQueueKey = key;
      const shown = st.queue.slice(0, QUEUE_SHOW);
      replace(
        queueEl,
        shown.map((i) => {
          const long = st.t - day.arrivals[i] > LONG_WAIT;
          return h("span", { class: `oc-person${long ? " is-long" : ""}` }, long ? "!" : "");
        }),
        st.queue.length > QUEUE_SHOW ? h("span", { class: "oc-more" }, `+${st.queue.length - QUEUE_SHOW} more`) : null,
      );
      queueLabel.textContent = st.queue.length
        ? `${st.queue.length} waiting${longWaiters ? `, ${longWaiters} for more than ${LONG_WAIT} minutes (marked !)` : ""}.`
        : running
          ? "No one is waiting."
          : "The desk is not open yet.";
    }

    if (st.period !== lastPeriod && running) {
      lastPeriod = st.period;
      renderPlan();
      if (st.t < close) sceneSummary.textContent = `${hourLabel(day, st.period)}: ${st.open} counters open, ${st.queue.length} in line, average wait so far ${mins(st.avgWait)}.`;
    }
    drawChart(false);
  }

  function drawChart(force) {
    const st = sim.state();
    const stamp = Math.floor(st.t / 4);
    if (!force && stamp === lastChart && !st.finished) return;
    lastChart = stamp;
    replace(chartEl, queueChart(day, [{ name: "Your line", trace: st.trace, upto: st.t, plan, cls: "is-you" }], { width: chartWidth(chartEl), now: running ? st.t : null }));
  }

  function loop(stamp) {
    if (!running || paused || ended) return;
    if (lastStamp == null) lastStamp = stamp;
    const dt = Math.min(0.1, (stamp - lastStamp) / 1000);
    lastStamp = stamp;
    simT += dt * SPEEDS.find((s) => s.id === speed).minPerSec;
    sim.advance(simT);
    drawScene();
    if (sim.finished) return finishDay();
    frame = requestAnimationFrame(loop);
  }

  function begin() {
    if (running) return;
    running = true;
    startBtn.hidden = true;
    pauseBtn.disabled = false;
    pauseBtn.focus();
    ctx.announce("The desk is open.");
    renderPlan();
    // On a phone the plan table sits above the desk, so bring the desk into view.
    const scene = ctx.stage.querySelector(".oc-scene");
    if (scene && scene.getBoundingClientRect().top > window.innerHeight * 0.6) scene.scrollIntoView({ behavior: "smooth", block: "start" });
    frame = requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!running || ended) return;
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    ctx.announce(paused ? "Paused." : "Resumed.");
    if (!paused) {
      lastStamp = null;
      frame = requestAnimationFrame(loop);
    }
  }

  function skip() {
    if (ended) return;
    running = true;
    sim.advance(Infinity);
    drawScene();
    finishDay(0);
  }

  function finishDay(delay = 700) {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    pauseBtn.disabled = true;
    skipBtn.disabled = true;
    renderPlan();
    endTimer = setTimeout(() => showResults(ctx, day, plan.slice(), sim.summary()), delay);
  }

  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      togglePause();
    }
  }
  document.addEventListener("keydown", onKey);
  ctx.onCleanup(() => {
    running = false;
    ended = true;
    cancelAnimationFrame(frame);
    clearTimeout(endTimer);
    document.removeEventListener("keydown", onKey);
  });

  renderPlan();
  drawScene();
}

function chartWidth(el) {
  const w = el && el.clientWidth ? el.clientWidth : 640;
  return Math.round(Math.min(720, Math.max(280, w)));
}

/**
 * Line length over the day as a step chart.
 * series: [{ name, trace: [{t, q}], upto (minutes drawn), plan, cls }]
 * o.now   draws a "now" marker (play screen)
 * o.rows  extra rows of numbers under the chart, one value per hour (results screen)
 */
function queueChart(day, series, o = {}) {
  const W = o.width || 640;
  const rowsBelow = o.rows || [];
  const m = { left: rowsBelow.length ? 50 : 34, right: 10, top: 24, bottom: 24 + 16 * rowsBelow.length };
  const Hc = 150;
  const H = Hc + m.top + m.bottom;
  const close = day.periods * PERIOD_MIN;
  const tMax = Math.max(close, ...series.map((s) => s.upto || 0));
  const qMax = Math.max(8, ...series.flatMap((s) => s.trace.map((p) => p.q)));
  const yTop = Math.ceil(qMax / 4) * 4;
  const X = (t) => m.left + ((W - m.left - m.right) * t) / tMax;
  const Y = (q) => m.top + Hc * (1 - q / yTop);
  const parts = [];

  for (let p = 0; p <= day.periods; p++) {
    parts.push(svg("line", { x1: X(p * PERIOD_MIN), y1: Y(0), x2: X(p * PERIOD_MIN), y2: Y(yTop), class: "oc-gridline" }));
    parts.push(svg("text", { x: X(p * PERIOD_MIN), y: Y(0) + 14, class: "oc-tick oc-tick-x" }, `${day.openHour + p}`));
  }
  for (let q = 0; q <= yTop; q += yTop / 4) {
    parts.push(svg("line", { x1: X(0), y1: Y(q), x2: X(tMax), y2: Y(q), class: "oc-gridline" }), svg("text", { x: X(0) - 5, y: Y(q) + 4, class: "oc-tick oc-tick-y" }, String(q)));
  }
  if (tMax > close) {
    parts.push(svg("rect", { x: X(close), y: Y(yTop), width: X(tMax) - X(close), height: Y(0) - Y(yTop), class: "oc-overtime" }));
    if (X(tMax) - X(close) > 26) parts.push(svg("text", { x: (X(close) + X(tMax)) / 2, y: Y(yTop) + 11, class: "oc-tick oc-tick-x" }, "late"));
  }

  rowsBelow.forEach((row, r) => {
    const y = Y(0) + 30 + 16 * r;
    parts.push(svg("text", { x: 0, y, class: "oc-rowlabel" }, row.label));
    row.values.forEach((v, p) => parts.push(svg("text", { x: (X(p * PERIOD_MIN) + X((p + 1) * PERIOD_MIN)) / 2, y, class: `oc-rowval ${row.cls || ""}` }, String(v))));
  });

  series.forEach((s) => {
    const upto = s.upto ?? tMax;
    let d = "";
    let q = 0;
    for (const p of s.trace) {
      if (p.t > upto) break;
      d += d ? ` H${X(p.t).toFixed(1)} V${Y(p.q).toFixed(1)}` : `M${X(p.t).toFixed(1)},${Y(p.q).toFixed(1)}`;
      q = p.q;
    }
    d += ` H${X(upto).toFixed(1)}`;
    parts.push(svg("path", { d, class: `oc-trace ${s.cls}` }));
    if (o.now != null) parts.push(svg("circle", { cx: X(upto), cy: Y(q), r: 4, class: `oc-now ${s.cls}` }));
  });

  const peak = (s) => Math.max(0, ...s.trace.map((p) => p.q));
  return svg(
    "svg",
    {
      class: "oc-svg",
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": `Line length over the day. ${series.map((s) => `${s.name}: longest line ${peak(s)}`).join(". ")}.`,
    },
    svg("text", { x: 0, y: 10, class: "oc-tick" }, "people in line"),
    parts,
  );
}

function showResults(ctx, day, plan, you) {
  const { rates, mu } = day;
  const best = formulaPlan(day);
  const lean = leanPlan(day);
  const fDay = simulate(day, best);
  const lDay = simulate(day, lean);
  // Every plan faces the same 200 random days, so the comparison is fair.
  const repRng = ctx.rng.fork("replications");
  const youAvg = replicate(day, plan, repRng);
  const fAvg = replicate(day, best, repRng);
  const lAvg = replicate(day, lean, repRng);

  const ratio = youAvg.totalCost / fAvg.totalCost;
  const stars = starsFor(youAvg.totalCost, fAvg.totalCost);
  const same = plan.every((c, p) => c === best[p]);
  const forecast = rates.reduce((s, r, p) => s + hourlyCost(r, mu, best[p], day.staffCost, day.waitCost), 0);
  const overloaded = plan.map((c, p) => (utilization(rates[p], mu, c) >= 1 ? p : -1)).filter((p) => p >= 0);

  const headline = same
    ? `${money(youAvg.totalCost)} per day: you matched the formula plan`
    : ratio < 0.999
      ? `${money(youAvg.totalCost)} per day: you beat the formula plan (${money(fAvg.totalCost)})`
      : ratio <= STAR_RATIOS[0]
        ? `${money(youAvg.totalCost)} per day: within ${pct(STAR_RATIOS[0] - 1, 0)} of the formula plan (${money(fAvg.totalCost)})`
        : `${money(youAvg.totalCost)} per day: ${pct(ratio - 1, 0)} more than the formula plan (${money(fAvg.totalCost)})`;

  const why =
    ratio <= STAR_RATIOS[0]
      ? ""
      : youAvg.waitCost - fAvg.waitCost > youAvg.staffCost - fAvg.staffCost
        ? ` The extra cost is mostly <b>waiting</b>: lines got too long${overloaded.length ? `, and in ${overloaded.length} hour${overloaded.length === 1 ? "" : "s"} more work arrived than the open counters could handle` : ""}.`
        : " The extra cost is mostly <b>staff</b>: counters stood idle while you paid for them.";

  // The hour that shows the utilization-versus-wait trade-off most clearly.
  const tp = tightestPeriod(day);
  const cMin = minCounters(rates[tp], mu);
  const options = [cMin - 1, cMin, cMin + 1, cMin + 2].filter((c) => c >= 1 && c <= day.maxCounters);
  const optionRows = options.map((c) => {
    const q = mmc(rates[tp], mu, c);
    const marks = [c === plan[tp] ? "you" : null, c === best[tp] ? "formula" : null].filter(Boolean).join(" · ");
    return h(
      "tr",
      {},
      h("th", { scope: "row" }, `${c}`),
      h("td", {}, pct(q.rho, 0)),
      h("td", {}, q.stable ? mins(q.Wq) : "grows all hour"),
      h("td", {}, money(c * day.staffCost)),
      h("td", {}, q.stable ? money(day.waitCost * q.Lq) : "no limit"),
      h("td", {}, q.stable ? money(hourlyCost(rates[tp], mu, c, day.staffCost, day.waitCost)) : "no limit"),
      h("td", { class: "oc-mark" }, marks),
    );
  });
  const tightTable = h(
    "div",
    { class: "g-table-wrap" },
    h(
      "table",
      { class: "g-table oc-options" },
      h("caption", {}, `Long-run averages from the Erlang C formulas for ${hourLabel(day, tp)} (${rates[tp]} arrivals per hour)`),
      h("thead", {}, h("tr", {}, ["Counters", "Utilization", "Average wait", "Staff per hour", "Waiting per hour", "Total per hour", ""].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, optionRows),
    ),
  );
  const tight = mmc(rates[tp], mu, cMin);
  const roomy = mmc(rates[tp], mu, cMin + 1);
  const yourTp = utilization(rates[tp], mu, plan[tp]);

  const leanGap = lAvg.totalCost / fAvg.totalCost - 1;
  const leanText =
    leanGap > 0.03
      ? `The <b>lean plan</b> opens just enough counters to stay under 100% utilization. It looks efficient (${pct(lAvg.utilization, 0)} of counter time is used), but the waiting it causes makes it ${money(lAvg.totalCost - fAvg.totalCost)} per day more expensive than the formula plan.`
      : `The <b>lean plan</b> opens just enough counters to stay under 100% utilization. Here it costs about the same as the formula plan (${money(lAvg.totalCost)} against ${money(fAvg.totalCost)}), because ${
          day.waitCost < day.staffCost ? "waiting is cheap compared with staff on this desk, so running close to full pays off" : "the two plans are nearly the same on this day"
        }.`;

  const debrief = [
    {
      title: "Utilization versus waiting",
      body: h(
        "div",
        {},
        h("p", { class: "g-formula" }, `utilization = arrival rate ÷ (counters × service rate) = ${rates[tp]} ÷ (${plan[tp]} × ${mu}) = ${pct(yourTp, 0)}   (your ${hourLabel(day, tp)})`),
        h(
          "p",
          {
            html: `<b>Utilization</b> is the share of counter time that arriving work needs. High utilization means little idle staff, but also little spare capacity to clear a line. Look at what each extra counter buys in one hour of this day:`,
          },
        ),
        tightTable,
      ),
    },
    {
      title: "Why waits explode near 100%",
      body: `<p>With ${cMin} counters that hour runs at ${pct(tight.rho, 0)} utilization and the average wait is ${mins(tight.Wq)}. One more counter drops utilization to ${pct(roomy.rho, 0)} and the wait to ${mins(
        roomy.Wq,
      )}. Utilization fell by ${fmt(100 * (tight.rho - roomy.rho), 0)} percentage points, but the wait became about ${roomy.Wq > 0 ? `${fmt(tight.Wq / roomy.Wq, 0)} times` : "many times"} shorter. Waiting does not grow in a straight line with utilization: it shoots up as utilization gets close to 100%.</p><p>The reason is randomness. Customers come in bunches and some jobs run long. A counter that sits idle during a quiet minute can't save that minute for the next rush, so at high utilization every bunch leaves a line that takes a long time to clear. At or above 100% the line never clears at all. That is why real service systems plan for some idle time.</p>`,
    },
    {
      title: "Cost of staff versus cost of waiting",
      body: `<p>Each counter costs ${money(day.staffCost)} per hour and each ${day.customer}-hour in line costs ${money(day.waitCost)}. Adding a counter is worth it only while it removes more than ${money(day.staffCost)} of waiting per hour. Over ${REPLICATIONS} simulated days your plan averages ${money(youAvg.staffCost)} for staff plus ${money(
        youAvg.waitCost,
      )} for waiting; the formula plan averages ${money(fAvg.staffCost)} plus ${money(fAvg.waitCost)}.</p><p>${leanText}</p>${
        day.waitCost >= 2 * day.staffCost
          ? `<p>On this desk a waiting ${day.customer} costs twice as much as a counter, so the best plan keeps utilization low. When waiting is expensive, idle counters are cheap insurance.</p>`
          : day.waitCost * 2 <= day.staffCost
            ? `<p>On this desk staff cost much more than waiting, so the best plan runs the counters hot and accepts longer lines.</p>`
            : ""
      }`,
    },
    {
      title: "Formulas versus one simulated day",
      body: `<p>The Erlang C formulas forecast ${money(forecast)} per day for the formula plan. Simulating that plan gives ${money(fAvg.totalCost)} on average over ${REPLICATIONS} days, and ${money(
        fDay.totalCost,
      )} on the single day you watched. One day is one roll of the dice, which is why your stars come from the ${REPLICATIONS}-day average and why simulation studies always repeat their runs.</p><p>The formulas also assume each hour runs long enough to settle into its long-run average. A real day starts with an empty desk and carries leftover lines from one hour into the next. So the formula plan is a strong benchmark, not a guaranteed best: a plan can beat it by a few percent.</p>`,
    },
  ];

  const three = [you, lDay, fDay];
  const avgs = [youAvg, lAvg, fAvg];
  ctx.finish({
    outcome: stars === 3 ? "win" : stars === 2 ? "ok" : "miss",
    stars,
    headline,
    summary: `On the day you watched, ${you.customers} customers waited <b>${mins(you.avgWait)}</b> on average and the day cost ${money(you.totalCost)}. Over ${REPLICATIONS} simulated days your plan averages <b>${money(
      youAvg.totalCost,
    )}</b> per day.${why} Three stars need a long-run cost within ${pct(STAR_RATIOS[0] - 1, 0)} of the formula plan; two stars within ${pct(STAR_RATIOS[1] - 1, 0)}.`,
    comparison: {
      caption: "Your plan compared with a lean plan and the Erlang C formula plan",
      columns: ["You", "Lean plan (just enough counters)", "Formula plan (Erlang C)"],
      rows: [
        { label: "Counters by hour", values: [plan, lean, best].map((p) => p.join(" ")) },
        { label: "Counter-hours", values: three.map((s) => String(s.counterHours)) },
        { label: "This day: average wait", values: three.map((s) => mins(s.avgWait)) },
        { label: "This day: longest line", values: three.map((s) => String(s.maxQueue)) },
        { label: "This day: utilization", values: three.map((s) => pct(s.utilization, 0)) },
        { label: "This day: total cost", values: three.map((s) => money(s.totalCost)) },
        { label: `${REPLICATIONS}-day average: wait`, values: avgs.map((s) => mins(s.avgWait)) },
        { label: `${REPLICATIONS}-day average: staff cost`, values: avgs.map((s) => money(s.staffCost)) },
        { label: `${REPLICATIONS}-day average: waiting cost`, values: avgs.map((s) => money(s.waitCost)) },
        { label: `${REPLICATIONS}-day average: total cost`, values: avgs.map((s) => money(s.totalCost)) },
      ],
    },
    figure: h(
      "figure",
      { class: "oc-figure" },
      queueChart(
        day,
        [
          { name: "Formula plan", trace: fDay.trace, upto: fDay.endTime, plan: best, cls: "is-formula" },
          { name: "Your plan", trace: you.trace, upto: you.endTime, plan, cls: "is-you" },
        ],
        {
          width: chartWidth(document.querySelector(".g-screen")),
          rows: [
            { label: "arrive", values: rates },
            { label: "you", values: plan, cls: "is-you" },
            { label: "formula", values: best, cls: "is-formula" },
          ],
        },
      ),
      h(
        "figcaption",
        {},
        h("span", { class: "oc-key" }, svg("svg", { viewBox: "0 0 28 8", width: 28, height: 8, "aria-hidden": "true" }, svg("path", { d: "M1,4 H27", class: "oc-trace is-you" })), " your plan"),
        h("span", { class: "oc-key" }, svg("svg", { viewBox: "0 0 28 8", width: 28, height: 8, "aria-hidden": "true" }, svg("path", { d: "M1,4 H27", class: "oc-trace is-formula" })), " formula plan"),
        " Line length on the same random day. The rows under the chart show arrivals per hour and the counters each plan opened.",
      ),
    ),
    debrief,
  });
}
