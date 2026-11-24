// Spot the Shift: watch a live X-bar and R chart and stop the line when the
// process goes out of control.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt, pct } from "../shared/dom.js";
import {
  ROUNDS,
  RULES,
  ALL_RULE_IDS,
  COST,
  N,
  A2,
  D4,
  SETUP,
  HORIZON,
  TARGET,
  SHIFT_STORIES,
  generateRound,
  rulesAt,
  scoreStops,
  simulateOperator,
  starsFor,
  arlRule1,
  rule1Probability,
} from "./logic.js";

const SPEEDS = [
  { id: "slow", label: "Slow", ms: 1100 },
  { id: "normal", label: "Normal", ms: 700 },
  { id: "fast", label: "Fast", ms: 380 },
];
const SHOW_SETUP = 10; // setup subgroups drawn in grey at the left of the chart
let speed = "normal"; // remembered across rounds

createGame({
  slug: "spot-the-shift",
  title: "Spot the Shift",
  tagline: "Keep the filler running, but not one bottle too long.",
  objective:
    "read an X-bar and R control chart, apply run rules to spot a process change, and weigh false alarms (Type I errors) against late detection (Type II errors).",
  minutes: "10-15",
  chapter: { href: "../../chapters/week-07.html", label: "Week 7 · Quality and Statistical Thinking" },
  howToPlay: [
    "A filling line puts 500 mL in each bottle. Every 15 minutes, 5 bottles are measured and plotted: their average (x̄) on the top chart and their range (R) on the bottom chart.",
    "At a hidden moment in every round, something goes wrong. It might be a jump, a spread, or a slow drift.",
    `Press <b>Stop the line</b> (or <kbd>S</kbd>) when you think the process has changed. A false alarm costs $${COST.falseAlarm}. Every subgroup made after the change costs $${COST.scrapPerSubgroup} in scrap.`,
    "Afterwards, see which control-chart rules would have fired, and when. <kbd>P</kbd> pauses.",
  ],
  levelNoun: "Round",
  levels: ROUNDS,
  start,
});

function start(ctx) {
  const round = generateRound(ctx.rng, ctx.level);
  const { limits: L, live, onset } = round;
  const stops = [];
  let shown = 0; // live subgroups revealed so far
  let running = false;
  let paused = false;
  let timer = null;
  let flash = null;

  ctx.setStatus(
    h(
      "p",
      { class: "ss-brief" },
      `Limits come from ${SETUP} setup subgroups of n = ${N}: `,
      h("span", { class: "ss-lim" }, `x̄ chart ${fmt(L.lcl, 2)} to ${fmt(L.ucl, 2)} mL`),
      ", ",
      h("span", { class: "ss-lim" }, `R chart up to ${fmt(L.rucl, 2)} mL`),
      ". Every round has exactly one hidden change.",
    ),
  );

  const chartEl = h("div", { class: "ss-chart" });
  const readout = h("p", { class: "ss-readout" });
  const feedback = h("div", { class: "ss-feedback", role: "status", "aria-live": "assertive" });
  const stopBtn = h("button", { type: "button", class: "g-btn g-btn-danger g-btn-lg ss-stop", onclick: stopLine, disabled: true }, "■ Stop the line");
  const startBtn = h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: begin }, "▶ Start production");
  const pauseBtn = h("button", { type: "button", class: "g-btn", onclick: togglePause, disabled: true }, "Pause");
  const counters = h("div", { class: "g-metrics ss-counters" });
  const speedGroup = h(
    "div",
    { class: "ss-speed", role: "radiogroup", "aria-label": "Speed" },
    h("span", { class: "ss-speed-label" }, "Speed"),
    SPEEDS.map((s) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          class: "ss-speed-btn",
          "aria-checked": String(s.id === speed),
          onclick: (e) => {
            speed = s.id;
            speedGroup.querySelectorAll("[role=radio]").forEach((b) => b.setAttribute("aria-checked", String(b === e.currentTarget)));
          },
        },
        s.label,
      ),
    ),
  );

  replace(
    ctx.stage,
    h("div", { class: "ss-controls" }, startBtn, stopBtn, pauseBtn, speedGroup),
    feedback,
    h("div", { class: "g-card ss-chart-card" }, chartEl, readout),
    counters,
  );

  function updateCounters() {
    replace(
      counters,
      counter("Subgroup", `${shown} / ${HORIZON}`),
      counter("False alarms", String(stops.length), stops.length ? "warn" : null),
      counter("Cost so far", `$${stops.length * COST.falseAlarm}`, stops.length ? "warn" : null),
    );
  }

  function draw() {
    replace(chartEl, drawCharts(round, { upto: shown, stops, width: chartWidth(chartEl) }));
    if (shown > 0) {
      const p = live[shown - 1];
      readout.textContent = `Subgroup ${shown}: x̄ = ${fmt(p.xbar, 2)} mL, R = ${fmt(p.r, 2)} mL.`;
    } else {
      readout.textContent = "Production hasn't started. The grey points are the last setup subgroups.";
    }
    updateCounters();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(tick, SPEEDS.find((s) => s.id === speed).ms);
  }

  function tick() {
    if (!running || paused) return;
    if (shown >= HORIZON) return endRound();
    shown += 1;
    draw();
    if (shown >= HORIZON) {
      timer = setTimeout(endRound, 600);
      return;
    }
    schedule();
  }

  function begin() {
    running = true;
    startBtn.hidden = true;
    stopBtn.disabled = false;
    pauseBtn.disabled = false;
    stopBtn.focus();
    ctx.announce("Production started.");
    tick();
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    ctx.announce(paused ? "Paused." : "Resumed.");
    if (!paused) schedule();
  }

  function stopLine() {
    if (!running || shown === 0) return;
    const i = shown - 1;
    if (stops.includes(i)) return;
    stops.push(i);
    if (i >= onset) return endRound();
    // False alarm: investigate, find nothing, restart.
    paused = true;
    clearTimeout(timer);
    stopBtn.disabled = true;
    replace(
      feedback,
      h("p", { class: "ss-fa" }, h("strong", {}, "False alarm. "), `The crew checked the filler and found nothing wrong. That stop cost $${COST.falseAlarm}. Restarting...`),
    );
    draw();
    clearTimeout(flash);
    flash = setTimeout(() => {
      paused = false;
      stopBtn.disabled = false;
      stopBtn.focus();
      schedule();
      flash = setTimeout(() => replace(feedback), 2500);
    }, 1800);
  }

  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (running && !stopBtn.disabled) stopLine();
      else if (!running) begin();
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      togglePause();
    }
  }
  document.addEventListener("keydown", onKey);
  ctx.onCleanup(() => {
    running = false;
    clearTimeout(timer);
    clearTimeout(flash);
    document.removeEventListener("keydown", onKey);
  });

  function endRound() {
    if (!running) return;
    running = false;
    clearTimeout(timer);
    showResults(ctx, round, stops);
  }

  draw();
}

/** Chart width that keeps SVG text near its CSS size: the container's width, clamped. */
function chartWidth(el) {
  const w = el && el.clientWidth ? el.clientWidth : 680;
  return Math.round(Math.min(680, Math.max(320, w)));
}

function counter(label, value, state) {
  return h("div", { class: "g-metric", dataset: state ? { state } : {} }, h("span", { class: "g-metric-label" }, label), h("span", { class: "g-metric-value" }, value));
}

// ---------------------------------------------------------------- charts

/**
 * Draw the X-bar and R charts.
 * opts.upto      number of live subgroups to show
 * opts.stops     indices where the player stopped the line
 * opts.reveal    show the change point and rule firings (results screen)
 * opts.width     drawing width in px; matching the container keeps text readable on phones
 */
function drawCharts(round, opts) {
  const { limits: L, live, setup, onset } = round;
  const upto = opts.upto;
  const W = opts.width || 680;
  const left = 54;
  const right = 46;
  const xTop = 14;
  const xH = 200;
  const rTop = xTop + xH + 30;
  const rH = 100;
  const stripTop = rTop + rH + 26;
  const stripRow = 15;
  const H = opts.reveal ? stripTop + RULES.length * stripRow + 24 : rTop + rH + 24;
  const slots = SHOW_SETUP + HORIZON;
  const step = (W - left - right) / (slots - 1);
  const x = (slot) => left + slot * step;
  const liveX = (i) => x(SHOW_SETUP + i);
  const setupPts = setup.slice(-SHOW_SETUP);
  const visible = live.slice(0, upto);

  const sx = L.sigmaXbar;
  const devs = [...setupPts, ...visible].map((p) => Math.abs(p.xbar - L.cl) / sx);
  const span = Math.max(4.2, ...devs.map((d) => d * 1.08));
  const yX = (v) => xTop + xH / 2 - ((v - L.cl) / (span * sx)) * (xH / 2);
  const rMax = Math.max(L.rucl * 1.25, ...[...setupPts, ...visible].map((p) => p.r * 1.08));
  const yR = (v) => rTop + rH - (v / rMax) * rH;

  const els = [];
  // Zones on the X-bar chart (A, B, C bands both sides).
  [3, 2, 1].forEach((k) => {
    els.push(svg("rect", { x: left, width: W - left - right, y: yX(L.cl + k * sx), height: yX(L.cl - k * sx) - yX(L.cl + k * sx), class: `ss-zone ss-zone-${k}` }));
  });
  if (opts.reveal) {
    els.push(svg("rect", { x: liveX(onset) - step / 2, y: xTop, width: W - right - liveX(onset) + step / 2, height: rTop + rH - xTop, class: "ss-after" }));
  }
  const hline = (y, cls, label, labelLeft) => {
    els.push(svg("line", { x1: left, x2: W - right, y1: y, y2: y, class: cls }));
    if (label) els.push(svg("text", { x: W - right + 4, y: y + 4, class: "ss-axis-label" }, label));
    if (labelLeft) els.push(svg("text", { x: left - 6, y: y + 4, class: "ss-axis-num" }, labelLeft));
  };
  hline(yX(L.ucl), "ss-limit", "UCL", fmt(L.ucl, 1));
  hline(yX(L.cl + 2 * sx), "ss-sigma", "+2σ");
  hline(yX(L.cl + sx), "ss-sigma", "+1σ");
  hline(yX(L.cl), "ss-center", "CL", fmt(L.cl, 1));
  hline(yX(L.cl - sx), "ss-sigma", "−1σ");
  hline(yX(L.cl - 2 * sx), "ss-sigma", "−2σ");
  hline(yX(L.lcl), "ss-limit", "LCL", fmt(L.lcl, 1));
  els.push(svg("text", { x: 4, y: xTop + 10, class: "ss-panel-label" }, "x̄ (mL)"));

  hline(yR(L.rucl), "ss-limit", "UCL", fmt(L.rucl, 1));
  hline(yR(L.rbar), "ss-center", "R̄", fmt(L.rbar, 1));
  hline(yR(0), "ss-axis", "", "0");
  els.push(svg("text", { x: 4, y: rTop + 10, class: "ss-panel-label" }, "R (mL)"));

  // Setup divider
  els.push(svg("line", { x1: liveX(0) - step / 2, x2: liveX(0) - step / 2, y1: xTop, y2: rTop + rH, class: "ss-divider" }));
  els.push(svg("text", { x: liveX(0) - step / 2 - 4, y: rTop - 10, class: "ss-small", "text-anchor": "end" }, "setup"));
  els.push(svg("text", { x: liveX(0) - step / 2 + 4, y: rTop - 10, class: "ss-small" }, "production →"));

  if (opts.reveal) {
    els.push(svg("line", { x1: liveX(onset) - step / 2, x2: liveX(onset) - step / 2, y1: xTop - 4, y2: rTop + rH, class: "ss-onset" }));
    els.push(svg("text", { x: liveX(onset) - step / 2 + 4, y: xTop + 2, class: "ss-onset-label" }, "change starts"));
  }

  const series = (pts, start, yFn, key, cls) => {
    if (!pts.length) return;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(start + i).toFixed(1)},${yFn(p[key]).toFixed(1)}`).join("");
    els.push(svg("path", { d, class: `ss-line ${cls}` }));
    pts.forEach((p, i) => {
      const beyond = key === "xbar" ? p.xbar > L.ucl || p.xbar < L.lcl : p.r > L.rucl;
      els.push(svg("circle", { cx: x(start + i), cy: yFn(p[key]), r: beyond ? 4.6 : 3.3, class: `ss-pt ${cls}${beyond ? " is-out" : ""}` }));
    });
  };
  series(setupPts, 0, yX, "xbar", "is-setup");
  series(setupPts, 0, yR, "r", "is-setup");
  series(visible, SHOW_SETUP, yX, "xbar", "is-live");
  series(visible, SHOW_SETUP, yR, "r", "is-live");

  // Player's stops: triangles above the X-bar chart.
  opts.stops.forEach((s) => {
    const cx = liveX(s);
    const fa = s < onset;
    els.push(svg("path", { d: `M${cx - 6},${xTop - 12} L${cx + 6},${xTop - 12} L${cx},${xTop - 2} z`, class: `ss-stop-mark${opts.reveal ? (fa ? " is-fa" : " is-hit") : ""}` }));
    els.push(svg("line", { x1: cx, x2: cx, y1: xTop - 2, y2: rTop + rH, class: "ss-stop-line" }));
    if (opts.reveal) els.push(svg("text", { x: cx, y: rTop + rH + 14, class: "ss-stop-label" }, fa ? "false alarm" : "you stopped"));
  });

  // Rule strip: every subgroup where each rule's pattern is present.
  if (opts.reveal) {
    els.push(svg("text", { x: 4, y: stripTop - 8, class: "ss-panel-label" }, "When each rule fires"));
    RULES.forEach((rule, k) => {
      const y = stripTop + k * stripRow + 8;
      els.push(svg("text", { x: left - 6, y: y + 4, class: "ss-axis-num" }, rule.short));
      els.push(svg("line", { x1: left, x2: W - right, y1: y, y2: y, class: "ss-strip-line" }));
      let first = true;
      for (let i = 0; i < live.length; i++) {
        if (!rulesAt(live, i, L).includes(rule.id)) continue;
        els.push(
          svg("rect", {
            x: liveX(i) - 3.5,
            y: y - 4.5,
            width: 7,
            height: 9,
            rx: 1.5,
            class: `ss-fire${i < onset ? " is-fa" : " is-hit"}${first ? " is-first" : ""}`,
          }),
        );
        first = false;
      }
    });
  }

  const latest = visible.length ? visible[visible.length - 1] : null;
  const label = opts.reveal
    ? `X-bar and R charts for all ${HORIZON} subgroups. The change starts at subgroup ${onset + 1}. You stopped at ${opts.stops.map((s) => s + 1).join(", ") || "no point"}.`
    : `X-bar and R charts, ${upto} of ${HORIZON} subgroups shown.${latest ? ` Latest x-bar ${fmt(latest.xbar, 2)}, range ${fmt(latest.r, 2)}.` : ""}`;
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "ss-svg", role: "img", "aria-label": label }, els);
}

// ---------------------------------------------------------------- results

function showResults(ctx, round, stops) {
  const { limits: L, onset, live, spec } = round;
  const you = scoreStops(stops, onset);
  const book = simulateOperator(round, ALL_RULE_IDS);
  const r1 = simulateOperator(round, ["R1"]);
  const stars = starsFor(you, book);
  const sub = (i) => (i == null ? "never" : `#${i + 1}`);
  const delayText = (o) => (o.detectIndex == null ? "missed" : String(o.delay));
  const ordinal = (k) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[k % 10] || "th"}`;

  let headline;
  if (you.detectIndex == null) headline = "The change slipped through";
  else if (you.delay <= 1) headline = "Caught it on the first changed subgroup";
  else headline = `Caught it after ${you.delay} changed subgroups`;

  // First firing of each rule (no restarts), relative to the change.
  const ruleRows = RULES.map((rule) => {
    let first = null;
    let firstAfter = null;
    for (let i = 0; i < live.length; i++) {
      if (!rulesAt(live, i, L).includes(rule.id)) continue;
      if (first == null) first = i;
      if (i >= onset && firstAfter == null) firstAfter = i;
    }
    return { rule, first, firstAfter };
  });

  const arl0 = arlRule1("none");
  const arl1 = spec.type === "trend" ? null : arlRule1(spec.type, spec.size);
  const p1 = spec.type === "trend" ? null : rule1Probability(spec.type, spec.size);

  ctx.finish({
    outcome: stars === 3 ? "win" : stars === 0 ? "miss" : "ok",
    stars,
    headline,
    summary: `${SHIFT_STORIES[spec.type](spec.size)} The change started at <b>subgroup ${onset + 1}</b>. ${
      you.detectIndex == null
        ? `You never stopped the line after it, so ${HORIZON - onset} subgroups of scrap were made and bad bottles reached customers.`
        : `You stopped at subgroup ${you.detectIndex + 1}.`
    } ${you.falseAlarms ? `Before that you raised ${you.falseAlarms} false alarm${you.falseAlarms > 1 ? "s" : ""}.` : ""}`,
    comparison: {
      caption: "You compared with operators who stop the moment a rule fires",
      columns: ["You", "All rules", "Rule 1 only"],
      rows: [
        { label: "False alarms", values: [you, book, r1].map((o) => String(o.falseAlarms)) },
        { label: "Stopped at subgroup", values: [you, book, r1].map((o) => sub(o.detectIndex)) },
        { label: "Changed subgroups made", values: [you, book, r1].map(delayText) },
        { label: "Total cost", values: [you, book, r1].map((o) => `$${o.cost.toLocaleString("en-US")}`) },
      ],
    },
    figure: h(
      "div",
      { class: "g-card ss-chart-card" },
      drawCharts(round, { upto: HORIZON, stops, reveal: true, width: chartWidth(document.querySelector(".g-screen")) - 20 }),
      h(
        "p",
        { class: "ss-legend" },
        h("span", { class: "ss-key ss-key-fa" }, "▮"),
        " rule fires before the change (would be a false alarm)  ",
        h("span", { class: "ss-key ss-key-hit" }, "▮"),
        " rule fires after the change (a true signal). The shaded region is after the change.",
      ),
    ),
    debrief: [
      {
        title: "Which rules would have caught it?",
        body: h(
          "div",
          { class: "g-table-wrap" },
          h(
            "table",
            { class: "g-table ss-rules" },
            h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Rule"), h("th", { scope: "col" }, "First fires"), h("th", { scope: "col" }, "First fires after the change"))),
            h(
              "tbody",
              {},
              ruleRows.map(({ rule, first, firstAfter }) =>
                h(
                  "tr",
                  {},
                  h("th", { scope: "row" }, h("b", {}, rule.short), h("br"), h("span", { class: "ss-rule-text" }, rule.text)),
                  h("td", {}, first == null ? "never" : `#${first + 1}${first < onset ? " (false alarm)" : ""}`),
                  h("td", {}, firstAfter == null ? "never" : `#${firstAfter + 1} (${ordinal(firstAfter - onset + 1)} changed)`),
                ),
              ),
            ),
          ),
        ),
      },
      {
        title: "Control limits",
        body: h(
          "div",
          {},
          h("p", {}, `The limits come from ${SETUP} setup subgroups of n = ${N} bottles, taken while the process was in control (target ${TARGET} mL).`),
          h("p", { class: "g-formula" }, `x̄ chart: CL = x̿ = ${fmt(L.cl, 2)},  UCL/LCL = x̿ ± A₂R̄ = ${fmt(L.cl, 2)} ± ${A2} × ${fmt(L.rbar, 2)} = ${fmt(L.lcl, 2)} to ${fmt(L.ucl, 2)}`),
          h("p", { class: "g-formula" }, `R chart: CL = R̄ = ${fmt(L.rbar, 2)},  UCL = D₄R̄ = ${D4} × ${fmt(L.rbar, 2)} = ${fmt(L.rucl, 2)},  LCL = 0`),
          h("p", {}, "The 1σ and 2σ lines split the x̄ chart into zones. Rules 2 to 4 look for patterns inside the limits that are unlikely when nothing has changed."),
        ),
      },
      {
        title: "Type I and Type II errors",
        body: `<p>A <b>false alarm</b> is a Type I error: stopping a process that was fine. You made ${you.falseAlarms}. With only Rule 1, the chance of a false alarm on any one subgroup is α ≈ ${pct(
          rule1Probability("none"),
          2,
        )}.</p><p>A <b>missed signal</b> is a Type II error: letting a changed process keep running. ${
          you.detectIndex == null ? `You let all ${HORIZON - onset} changed subgroups pass.` : `You let ${you.delay - 1} changed subgroup${you.delay - 1 === 1 ? "" : "s"} pass before stopping.`
        } Adding more rules catches changes sooner but raises more false alarms. In this round the all-rules operator raised ${book.falseAlarms} and the Rule-1-only operator raised ${r1.falseAlarms}.</p>`,
      },
      {
        title: "Average run length",
        body: `<p>The <b>average run length</b> (ARL) is how many subgroups pass, on average, before a chart signals. With Rule 1 alone, an in-control process gives a false alarm about once every <b>${fmt(
          arl0,
          0,
        )}</b> subgroups (1 ÷ α).</p><p>${
          arl1 != null
            ? `For this round's change, each subgroup has a ${pct(p1, 0)} chance of landing outside the limits, so Rule 1 needs about <b>${fmt(
                arl1,
                1,
              )}</b> subgroups on average to catch it. Small changes have long run lengths, which is why the zone rules exist.`
            : "For a slow drift the chance of a signal grows every subgroup, so the run length depends on how fast the drift is. The trend rule and Rule 4 are built for exactly this."
        }</p>`,
      },
    ],
  });
}
