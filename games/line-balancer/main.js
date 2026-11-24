// Line Balancer: assign precedence-constrained tasks to workstations so the
// line keeps up with demand (takt time) using as few stations as possible.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt, pct } from "../shared/dom.js";
import {
  LEVELS,
  generateInstance,
  evaluate,
  readyTasks,
  layers,
  positionalWeights,
  theoreticalMinStations,
  rankedPositionalWeight,
  largestCandidate,
  optimalStations,
  starsFor,
} from "./logic.js";

const PALETTE = 8; // --c1 ... --c8 in shared/game.css
const DARK_TEXT = new Set([2, 5, 7]); // light palette entries that need dark text

function stationColor(s) {
  return `var(--c${(s % PALETTE) + 1})`;
}
function stationInk(s) {
  return DARK_TEXT.has((s % PALETTE) + 1) ? "#1f2a2e" : "#ffffff";
}

createGame({
  slug: "line-balancer",
  title: "Line Balancer",
  tagline: "Split the work so the line keeps pace with demand.",
  objective:
    "compute takt time from demand, assign tasks to workstations without breaking precedence, and judge a line by its number of stations, cycle time, and balance efficiency.",
  minutes: "10-15",
  chapter: { href: "../../chapters/week-05.html", label: "Week 5 · Manufacturing Processes and Production Systems" },
  howToPlay: [
    "Each product needs a set of tasks. Arrows in the <b>precedence diagram</b> show which tasks must be done first.",
    "Customer demand sets the <b>takt time</b>: no station may have more work than that per unit.",
    "Drag a task onto a station, or tap a task and then tap a station. With a keyboard, press <kbd>Enter</kbd> on a task, then a number key <kbd>1</kbd>-<kbd>9</kbd> for the station (<kbd>0</kbd> sends it back).",
    "A task can't sit in an earlier station than any task it depends on. Use as few stations as you can, then press <b>Submit line</b>.",
  ],
  levels: LEVELS,
  start,
});

function start(ctx) {
  const inst = generateInstance(ctx.rng, ctx.level);
  const { tasks, takt } = inst;
  const n = tasks.length;
  const assignment = new Array(n).fill(null);
  const lb = theoreticalMinStations(inst);
  let stationCount = Math.max(2, lb - 1);
  let selected = null;
  const depth = layers(tasks);

  ctx.setStatus(
    h(
      "p",
      { class: "lb-brief" },
      h("strong", {}, `${ctx.level.name}: `),
      `customers need ${inst.demand} units in a ${inst.availableSec / 60}-minute shift. `,
      "Takt time = ",
      h("span", { class: "g-formula lb-inline" }, `${inst.availableSec} s ÷ ${inst.demand} = ${takt} s`),
      " per unit.",
    ),
  );

  const metricsEl = h("div", { class: "g-metrics lb-metrics", "aria-label": "Line metrics" });
  const diagramEl = h("div", { class: "lb-diagram-scroll" });
  const trayEl = h("div", { class: "lb-tray" });
  const stationsEl = h("div", { class: "lb-stations" });
  const footEl = h("div", { class: "lb-foot" });
  replace(
    ctx.stage,
    metricsEl,
    h(
      "div",
      { class: "lb-grid" },
      h("section", { class: "g-card lb-diagram-card", "aria-label": "Precedence diagram" }, h("h2", { class: "lb-h" }, "Precedence diagram"), diagramEl),
      h("section", { class: "g-card lb-tray-card", "aria-label": "Unassigned tasks" }, h("h2", { class: "lb-h" }, "Tasks to place"), trayEl),
    ),
    h("section", { class: "lb-stations-wrap", "aria-label": "Workstations" }, stationsEl),
    footEl,
  );

  function assign(taskId, station) {
    if (taskId == null) return;
    const t = tasks[taskId];
    assignment[taskId] = station;
    if (station != null && station >= stationCount) stationCount = station + 1;
    selected = null;
    render(station == null ? `tray` : `station-${station}`);
    ctx.announce(station == null ? `Task ${t.label} back in the task list.` : `Task ${t.label} placed in station ${station + 1}.`);
  }

  function select(taskId) {
    selected = selected === taskId ? null : taskId;
    render(`task-${taskId}`);
    if (selected != null) ctx.announce(`Task ${tasks[taskId].label} selected. Choose a station.`);
  }

  // Keyboard: number keys place the selected task.
  function onKey(e) {
    if (selected == null || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^[0-9]$/.test(e.key)) {
      const k = Number(e.key);
      if (k === 0) assign(selected, null);
      else if (k <= stationCount + 1) assign(selected, k - 1);
      e.preventDefault();
    } else if (e.key === "Escape") {
      selected = null;
      render();
    }
  }
  document.addEventListener("keydown", onKey);
  ctx.onCleanup(() => document.removeEventListener("keydown", onKey));

  function chip(t, where) {
    const s = assignment[t.id];
    const ready = s != null || t.preds.every((p) => assignment[p] != null);
    const needs = t.preds.filter((p) => assignment[p] == null).map((p) => tasks[p].label);
    return h(
      "button",
      {
        type: "button",
        class: `lb-chip${selected === t.id ? " is-selected" : ""}${ready ? "" : " is-blocked"}`,
        draggable: "true",
        "aria-pressed": String(selected === t.id),
        "aria-label": `Task ${t.label}, ${t.time} seconds${s != null ? `, in station ${s + 1}` : ""}${
          t.preds.length ? `, after ${t.preds.map((p) => tasks[p].label).join(" and ")}` : ""
        }`,
        dataset: { key: `task-${t.id}` },
        style: s != null ? `--chip:${stationColor(s)};--chip-ink:${stationInk(s)}` : null,
        onclick: () => select(t.id),
        ondragstart: (e) => {
          e.dataTransfer.setData("text/plain", String(t.id));
          e.dataTransfer.effectAllowed = "move";
        },
      },
      h("span", { class: "lb-chip-label" }, t.label),
      h("span", { class: "lb-chip-time" }, `${t.time} s`),
      where === "tray" && needs.length ? h("span", { class: "lb-chip-needs" }, `after ${needs.join(", ")}`) : null,
    );
  }

  function dropTarget(el, station) {
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("is-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("is-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("is-over");
      const id = Number(e.dataTransfer.getData("text/plain"));
      if (Number.isInteger(id) && id >= 0 && id < n) assign(id, station);
    });
    return el;
  }

  function renderDiagram(m) {
    const colW = 84;
    const rowH = 60;
    // distance from a node's center to its rectangle border along (ux, uy)
    const edgeGap = (ux, uy) => Math.min(24 / Math.max(Math.abs(ux), 1e-6), 20 / Math.max(Math.abs(uy), 1e-6));
    const cols = Math.max(...depth) + 1;
    const byCol = Array.from({ length: cols }, () => []);
    tasks.forEach((t) => byCol[depth[t.id]].push(t.id));
    const rows = Math.max(...byCol.map((c) => c.length));
    const W = cols * colW + 10;
    const H = rows * rowH + 16;
    const pos = [];
    byCol.forEach((ids, c) => {
      const offset = ((rows - ids.length) * rowH) / 2;
      ids.forEach((id, r) => (pos[id] = { x: 34 + c * colW, y: 32 + offset + r * rowH }));
    });
    const bad = new Set(m.violations.map((v) => `${v.from}-${v.to}`));
    const edges = [];
    tasks.forEach((t) =>
      t.preds.forEach((p) => {
        const a = pos[p];
        const b = pos[t.id];
        const isBad = bad.has(`${p}-${t.id}`);
        const dx = b.x - a.x;
        const len = Math.hypot(dx, b.y - a.y);
        const ux = dx / len;
        const uy = (b.y - a.y) / len;
        edges.push(
          svg("line", {
            x1: a.x + ux * edgeGap(ux, uy),
            y1: a.y + uy * edgeGap(ux, uy),
            x2: b.x - ux * (edgeGap(ux, uy) + 4),
            y2: b.y - uy * (edgeGap(ux, uy) + 4),
            class: `lb-edge${isBad ? " is-bad" : ""}`,
            "marker-end": `url(#${isBad ? "lb-arrow-bad" : "lb-arrow"})`,
          }),
        );
      }),
    );
    const nodes = tasks.map((t) => {
      const { x, y } = pos[t.id];
      const s = assignment[t.id];
      const ready = s == null && t.preds.every((p) => assignment[p] != null);
      return svg(
        "g",
        {
          class: `lb-node${selected === t.id ? " is-selected" : ""}${ready ? " is-ready" : ""}`,
          transform: `translate(${x},${y})`,
          onclick: () => select(t.id),
        },
        svg("rect", { x: -24, y: -20, width: 48, height: 40, rx: 9, style: s != null ? `fill:${stationColor(s)}` : null, class: s != null ? "is-placed" : "" }),
        svg("text", { class: "lb-node-label", y: -2, style: s != null ? `fill:${stationInk(s)}` : null }, t.label),
        svg("text", { class: "lb-node-time", y: 13, style: s != null ? `fill:${stationInk(s)}` : null }, `${t.time}s`),
        s != null
          ? svg("g", { class: "lb-node-badge", transform: "translate(22,-19)" }, svg("circle", { r: 9 }), svg("text", { dy: "0.35em" }, String(s + 1)))
          : null,
      );
    });
    const marker = (id) =>
      svg("marker", { id, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { d: "M0,0 L10,5 L0,10 z" }));
    replace(
      diagramEl,
      svg(
        "svg",
        {
          class: "lb-diagram",
          viewBox: `0 0 ${W} ${H}`,
          width: W,
          height: H,
          role: "img",
          "aria-label": `Precedence diagram. ${tasks
            .filter((t) => t.preds.length)
            .map((t) => `${t.label} after ${t.preds.map((p) => tasks[p].label).join(" and ")}`)
            .join("; ")}.`,
        },
        svg("defs", {}, marker("lb-arrow"), marker("lb-arrow-bad")),
        edges,
        nodes,
      ),
    );
  }

  function metric(label, value, state) {
    return h("div", { class: "g-metric", dataset: state ? { state } : {} }, h("span", { class: "g-metric-label" }, label), h("span", { class: "g-metric-value" }, value));
  }

  function render(focusKey) {
    const key = focusKey || document.activeElement?.dataset?.key;
    const m = evaluate(inst, assignment, stationCount);

    replace(
      metricsEl,
      metric("Takt time", `${takt} s`),
      metric("Stations used", `${m.stationsUsed}`, m.complete && m.feasible ? (m.stationsUsed <= lb ? "good" : null) : null),
      metric("Cycle time", `${m.cycleTime} s`, m.cycleTime > takt ? "bad" : null),
      metric("Idle per unit", `${m.idlePerUnit} s`),
      metric("Efficiency", m.stationsUsed ? pct(m.efficiency) : "-"),
      metric("Precedence errors", `${m.violations.length}`, m.violations.length ? "bad" : null),
    );

    renderDiagram(m);

    const unplaced = tasks.filter((t) => assignment[t.id] == null);
    replace(
      trayEl,
      dropTarget(
        h(
          "div",
          { class: "lb-tray-drop", dataset: { key: "tray" } },
          unplaced.length ? unplaced.map((t) => chip(t, "tray")) : h("p", { class: "lb-empty" }, "All tasks placed."),
        ),
        null,
      ),
      selected != null && assignment[selected] != null
        ? h("button", { type: "button", class: "g-btn g-btn-ghost lb-unassign", dataset: { key: "unassign" }, onclick: () => assign(selected, null) }, `Return ${tasks[selected].label} to this list`)
        : null,
      h("p", { class: "lb-hint" }, `Ready to place now: ${readyTasks(inst, assignment).map((i) => tasks[i].label).join(", ") || "none"}. Total work content: ${inst.totalTime} s.`),
    );

    const stationCards = [];
    for (let s = 0; s < stationCount; s++) {
      const load = m.loads[s] || 0;
      const over = load > takt;
      const isBottleneck = m.bottleneck === s && load > 0 && m.stationsUsed > 1;
      const card = h(
        "div",
        { class: `lb-station${over ? " is-over-takt" : ""}`, style: `--st:${stationColor(s)}` },
        h(
          "button",
          {
            type: "button",
            class: "lb-station-head",
            dataset: { key: `station-${s}` },
            "aria-label": `Station ${s + 1}, load ${load} of ${takt} seconds${selected != null ? `. Place task ${tasks[selected].label} here` : ""}`,
            onclick: () => (selected != null ? assign(selected, s) : null),
          },
          h("span", { class: "lb-station-name" }, h("span", { class: "lb-swatch", "aria-hidden": "true" }), `Station ${s + 1}`),
          h("span", { class: "lb-station-load" }, `${load} / ${takt} s`),
          selected != null ? h("span", { class: "lb-place" }, `Place ${tasks[selected].label} here`) : null,
        ),
        h(
          "div",
          { class: "lb-bar", "aria-hidden": "true" },
          h("div", { class: `lb-bar-fill${over ? " is-over" : ""}`, style: `width:${Math.min(100, (100 * load) / takt)}%` }),
        ),
        h(
          "p",
          { class: "lb-station-note" },
          over ? `Over takt by ${load - takt} s` : load ? `Idle ${takt - load} s per unit${isBottleneck ? " · bottleneck" : ""}` : "Empty",
        ),
        h(
          "div",
          { class: "lb-station-tasks" },
          (m.members[s] || []).map((id) => chip(tasks[id], "station")),
        ),
      );
      stationCards.push(dropTarget(card, s));
    }
    const lastEmpty = stationCount > 1 && !(m.loads[stationCount - 1] > 0);
    replace(
      stationsEl,
      stationCards,
      h(
        "div",
        { class: "lb-station-tools" },
        h("button", { type: "button", class: "g-btn", dataset: { key: "add" }, onclick: () => ((stationCount += 1), render("add")) }, "+ Add station"),
        lastEmpty
          ? h("button", { type: "button", class: "g-btn g-btn-ghost", dataset: { key: "remove" }, onclick: () => ((stationCount -= 1), render("add")) }, "Remove last empty station")
          : null,
      ),
    );

    const problems = [];
    if (m.unassigned.length) problems.push(`${m.unassigned.length} task${m.unassigned.length > 1 ? "s" : ""} not placed`);
    if (m.overloaded.length) problems.push(`station ${m.overloaded.map((s) => s + 1).join(", ")} over takt`);
    if (m.violations.length)
      problems.push(`${m.violations.map((v) => `${tasks[v.to].label} is before ${tasks[v.from].label}`).join("; ")}`);
    replace(
      footEl,
      h(
        "div",
        { class: "g-actions" },
        h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", dataset: { key: "submit" }, disabled: m.feasible ? null : true, onclick: submit }, "Submit line"),
        h(
          "button",
          {
            type: "button",
            class: "g-btn g-btn-ghost",
            dataset: { key: "clear" },
            onclick: () => {
              assignment.fill(null);
              selected = null;
              render("clear");
            },
          },
          "Clear all",
        ),
      ),
      h("p", { class: `lb-problems${problems.length ? "" : " is-ok"}`, role: "note" }, problems.length ? `To submit: ${problems.join(" · ")}.` : "The line is feasible. Submit it, or try to use fewer stations."),
    );

    if (key) ctx.stage.querySelector(`[data-key="${key}"]`)?.focus({ preventScroll: true });
  }

  function submit() {
    const m = evaluate(inst, assignment, stationCount);
    if (!m.feasible) return;
    const opt = optimalStations(inst);
    const rpw = rankedPositionalWeight(inst);
    const lcr = largestCandidate(inst);
    const mo = evaluate(inst, opt.assignment, 0);
    const mr = evaluate(inst, rpw.assignment, 0);
    const ml = evaluate(inst, lcr.assignment, 0);
    const stars = starsFor(m.stationsUsed, opt.stations);
    const bottleneckLoad = m.loads[m.bottleneck];
    const pw = positionalWeights(tasks);
    const topPw = tasks
      .map((t) => t.id)
      .sort((a, b) => pw[b] - pw[a])
      .slice(0, 3)
      .map((i) => `${tasks[i].label} (${pw[i]} s)`)
      .join(", ");

    const outcome = stars === 3 ? "win" : stars === 2 ? "ok" : "miss";
    const headline =
      stars === 3 ? `Balanced with ${m.stationsUsed} stations, the best possible` : `Balanced with ${m.stationsUsed} stations; ${opt.stations} was possible`;

    ctx.finish({
      outcome,
      stars,
      headline,
      summary: `Your line meets the takt time of <b>${takt} s</b>. Its slowest station takes ${m.cycleTime} s, so it can make up to ${Math.floor(
        inst.availableSec / m.cycleTime,
      )} units per shift against a demand of ${inst.demand}.`,
      comparison: {
        caption: "Your line compared with two classic heuristics and the exact optimum",
        columns: ["You", "Largest candidate", "Ranked positional weight", "Best possible"],
        rows: [
          { label: "Stations", values: [m, ml, mr, mo].map((x) => String(x.stationsUsed)) },
          { label: "Cycle time (s)", values: [m, ml, mr, mo].map((x) => String(x.cycleTime)) },
          { label: "Idle per unit (s)", values: [m, ml, mr, mo].map((x) => String(x.idlePerUnit)) },
          { label: "Balance efficiency", values: [m, ml, mr, mo].map((x) => pct(x.efficiency)) },
        ],
      },
      figure: h(
        "div",
        { class: "lb-compare" },
        lineChart("Your line", m, takt, tasks),
        lineChart("Best possible line", mo, takt, tasks),
      ),
      debrief: [
        {
          title: "Takt time",
          body: h(
            "div",
            {},
            h("p", { class: "g-formula" }, `takt = available time ÷ demand = ${inst.availableSec} s ÷ ${inst.demand} units = ${takt} s per unit`),
            h("p", {}, "Takt time is the pace the customer sets. Every station must finish its share of a unit within the takt time, or work piles up in front of it."),
          ),
        },
        {
          title: "Bottleneck and cycle time",
          body: `<p>Your slowest station, <b>station ${m.bottleneck + 1}</b>, has ${bottleneckLoad} s of work. That station is the <b>bottleneck</b>: it sets the line's cycle time of ${m.cycleTime} s, and every other station waits for it. ${
            m.cycleTime < takt ? `It is ${takt - m.cycleTime} s faster than takt, which leaves a small safety margin.` : "It runs exactly at takt, with no margin for a slow cycle."
          }</p>`,
        },
        {
          title: "Balance efficiency and balance delay",
          body: h(
            "div",
            {},
            h("p", { class: "g-formula" }, `efficiency = Σt ÷ (n × takt) = ${inst.totalTime} ÷ (${m.stationsUsed} × ${takt}) = ${pct(m.efficiency)}`),
            h("p", { class: "g-formula" }, `balance delay = 1 − efficiency = ${pct(m.balanceDelay)}`),
            h("p", {}, `Balance delay is the share of paid station time that is idle. Each unit carries ${m.idlePerUnit} s of idle time spread across your stations.`),
          ),
        },
        {
          title: "How good could it be?",
          body: `<p>The <b>theoretical minimum</b> is ⌈Σt ÷ takt⌉ = ⌈${inst.totalTime} ÷ ${takt}⌉ = <b>${lb}</b> stations. ${
            opt.stations > lb
              ? `Here the true optimum is <b>${opt.stations}</b>: tasks can't be split and the arrows force some idle time, so the bound can't be reached.`
              : `Here the optimum reaches that bound.`
          }</p><p>The <b>ranked positional weight</b> method ranks each task by its own time plus the time of everything that must come after it (top three: ${topPw}), then fills stations in that order. It used ${rpw.stations} stations. The <b>largest candidate rule</b> simply takes the longest ready task first and used ${lcr.stations}. Heuristics are fast, but not always optimal.</p>`,
        },
      ],
    });
  }

  render();
}

/** Small bar chart of station loads, stacked by task, with the takt line. */
function lineChart(title, m, takt, tasks) {
  const k = m.loads.length;
  const barW = 36;
  const gap = 10;
  const H = 170;
  const top = 26;
  const maxV = Math.max(takt, ...m.loads) * 1.08;
  const W = 36 + k * (barW + gap);
  const y = (v) => top + (H - top) * (1 - v / maxV);
  const parts = [];
  m.members.forEach((ids, s) => {
    const x = 32 + s * (barW + gap);
    let acc = 0;
    ids.forEach((id) => {
      const t = tasks[id];
      parts.push(svg("rect", { x, y: y(acc + t.time), width: barW, height: y(acc) - y(acc + t.time), class: "lb-chart-seg", style: `fill:${stationColor(s)}` }));
      if (y(acc) - y(acc + t.time) >= 13) {
        parts.push(svg("text", { x: x + barW / 2, y: (y(acc) + y(acc + t.time)) / 2 + 4, class: "lb-chart-seg-label", style: `fill:${stationInk(s)}` }, t.label));
      }
      acc += t.time;
    });
    parts.push(
      svg("text", { x: x + barW / 2, y: 12, class: "lb-chart-val" }, `${acc}s`),
      svg("text", { x: x + barW / 2, y: H + 14, class: "lb-chart-x" }, `S${s + 1}`),
    );
  });
  return h(
    "figure",
    { class: "lb-chart" },
    svg(
      "svg",
      { viewBox: `0 0 ${W} ${H + 20}`, width: W, height: H + 20, role: "img", "aria-label": `${title}: station loads ${m.loads.join(", ")} seconds against a takt time of ${takt} seconds.` },
      parts,
      svg("line", { x1: 28, x2: W - 2, y1: y(takt), y2: y(takt), class: "lb-chart-takt" }),
      svg("text", { x: 0, y: y(takt) + 4, class: "lb-chart-takt-label" }, "takt"),
      svg("line", { x1: 28, x2: W - 2, y1: y(0), y2: y(0), class: "lb-chart-axis" }),
    ),
    h("figcaption", {}, `${title}: ${k} stations`),
  );
}
