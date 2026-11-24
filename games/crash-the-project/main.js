// Crash the Project: buy days off activities to find the cheapest schedule.
import { createGame } from "../shared/shell.js";
import { h, svg, replace } from "../shared/dom.js";
import { ASSUMPTIONS, LEVELS, generateProject, evaluate, solve, marginalSteps, savingPerDay, starsFor, usd } from "./logic.js";

const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
const pathText = (p) => p.ids.join(" → ");

createGame({
  slug: "crash-the-project",
  title: "Crash the Project",
  tagline: "Every day costs money. Which days are worth buying back?",
  objective:
    "find the critical path and slack of a project network, shorten the project by crashing the cheapest critical activities first, and stop when another day costs more than it saves.",
  minutes: "10-15",
  chapter: { href: "../../chapters/week-13.html", label: "Week 13 · Planning and Managing Engineering Projects" },
  howToPlay: [
    "The diagram shows a project. Each box is an activity, and an arrow means the first activity must finish before the next can start.",
    "The longest path through the diagram is the <b>critical path</b>. It sets the project's length. Other activities have <b>slack</b>: spare days.",
    "Every project day costs overhead (the <b>indirect cost</b>). You can <b>crash</b> an activity: pay its cost per day to make it one day shorter, down to its crash limit.",
    "Tap a box to select that activity, then press <b>Crash 1 day</b>. Watch the project length, the critical path, and the total cost. <b>Undo</b> gives the day and the money back. The same buttons are in the activity list.",
    "Find the lowest total cost, then press <b>Submit schedule</b>. Later levels add a deadline with a penalty for every late day.",
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start,
});

function start(ctx) {
  const project = generateProject(ctx.rng, ctx.level);
  const { acts } = project;
  const crash = acts.map(() => 0);
  const normal = evaluate(project, crash);
  let selected = normal.critical.indexOf(true);
  let message = { tone: "info", text: `Nothing is crashed yet. The project takes ${days(normal.duration)}. Thick boxes and arrows are critical.` };

  ctx.setStatus(
    h(
      "p",
      { class: "cp-brief" },
      h("strong", {}, `${project.name}. `),
      `Indirect cost: ${usd(project.indirect)} for every day the project runs. `,
      project.deadline != null ? h("span", {}, "Deadline: ", h("b", {}, `day ${project.deadline}`), `. Every day late costs ${usd(project.penalty)} more.`) : null,
    ),
  );

  const metricsEl = h("div", { class: "g-metrics cp-metrics", "aria-label": "Schedule and cost" });
  const netEl = h("div", { class: "g-card cp-net-card" });
  const panelEl = h("div", { class: "cp-panel" });
  const msgEl = h("p", { class: "cp-msg", role: "status" });
  const listEl = h("ul", { class: "cp-acts", "aria-label": "Activities" });
  const pathsEl = h("div", { class: "cp-paths" });
  replace(
    ctx.stage,
    metricsEl,
    netEl,
    panelEl,
    msgEl,
    h("div", { class: "cp-columns" }, h("section", {}, h("h2", { class: "g-h2 cp-h2" }, "Activities"), listEl), h("section", {}, h("h2", { class: "g-h2 cp-h2" }, "Paths"), pathsEl)),
    h(
      "div",
      { class: "g-actions cp-actions" },
      h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: () => showResults(ctx, project, crash.slice()) }, "Submit schedule"),
      h("button", { type: "button", class: "g-btn", onclick: reset }, "Reset to normal"),
    ),
  );

  function render(focusKey) {
    const e = evaluate(project, crash);
    const late = e.late > 0;
    replace(
      metricsEl,
      metric("Project length", days(e.duration), late ? "bad" : e.duration < normal.duration ? "good" : null, late ? `${days(e.late)} late` : project.deadline != null ? "on time" : null),
      metric("Crash cost", usd(e.crashCost)),
      metric("Indirect cost", usd(e.indirect)),
      project.deadline != null ? metric("Late penalty", usd(e.penalty), late ? "bad" : null) : null,
      metric("Total cost", usd(e.total), e.total < normal.total ? "good" : e.total > normal.total ? "warn" : null, `no crashing: ${usd(normal.total)}`),
    );
    replace(netEl, drawNetwork(project, e, { width: netWidth(netEl), selected, onPick: select }), legend());
    replace(panelEl, selectedPanel(e));
    msgEl.className = `cp-msg is-${message.tone}`;
    msgEl.textContent = message.text;
    replace(
      listEl,
      acts.map((a, i) => activityRow(a, i, e)),
    );
    replace(
      pathsEl,
      h(
        "ul",
        { class: "cp-path-list" },
        [...e.paths]
          .sort((p, q) => q.length - p.length)
          .map((p) => h("li", { class: p.critical ? "is-critical" : null }, h("span", { class: "cp-path-ids" }, pathText(p)), h("span", { class: "cp-path-len" }, days(p.length)), p.critical ? h("span", { class: "cp-chip is-critical" }, "★ critical") : h("span", { class: "cp-chip" }, `${days(e.duration - p.length)} spare`))),
      ),
    );
    if (focusKey) ctx.stage.querySelector(`[data-fk="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  function select(i) {
    selected = i;
    render(`node-${i}`);
  }

  /** Crash and undo buttons for one activity; `prefix` keeps focus keys apart (panel vs. list). */
  function crashButtons(a, i, prefix) {
    const canCrash = crash[i] < a.maxCrash;
    const canUndo = crash[i] > 0;
    return [
      h(
        "button",
        {
          type: "button",
          class: `g-btn cp-btn${prefix === "sel" ? " g-btn-primary" : ""}`,
          "aria-disabled": canCrash ? null : "true",
          dataset: { fk: `${prefix}-crash-${i}` },
          "aria-label": canCrash ? `Crash ${a.id}, ${a.name}, by one day for ${usd(a.costPerDay)}` : `${a.id} can't be crashed any further`,
          onclick: () => change(i, +1, `${prefix}-crash-${i}`),
        },
        a.maxCrash === 0 ? "Can't be crashed" : canCrash ? `Crash 1 day · ${usd(a.costPerDay)}` : "At crash limit",
      ),
      h(
        "button",
        {
          type: "button",
          class: "g-btn g-btn-ghost cp-btn",
          "aria-disabled": canUndo ? null : "true",
          dataset: { fk: `${prefix}-undo-${i}` },
          "aria-label": `Undo one crash day on ${a.id}`,
          onclick: () => change(i, -1, `${prefix}-undo-${i}`),
        },
        "Undo",
      ),
    ];
  }

  /** The selected activity, right under the diagram, so phones don't need to scroll to the list. */
  function selectedPanel(e) {
    const a = acts[selected];
    return [
      h("span", { class: "cp-id" }, a.id),
      h(
        "div",
        { class: "cp-act-main" },
        h("span", { class: "cp-act-name" }, a.name),
        h(
          "span",
          { class: "cp-act-sub" },
          `now ${e.durations[selected]} d (normal ${a.normal}, crash limit ${a.crashTime}) · `,
          e.critical[selected] ? "★ critical" : `slack ${e.slack[selected]} d`,
        ),
      ),
      h("div", { class: "cp-panel-ctrl" }, crashButtons(a, selected, "sel")),
    ];
  }

  function activityRow(a, i, e) {
    return h(
      "li",
      { class: `cp-act${e.critical[i] ? " is-critical" : ""}${i === selected ? " is-selected" : ""}` },
      h("span", { class: "cp-id" }, a.id),
      h(
        "div",
        { class: "cp-act-main" },
        h("span", { class: "cp-act-name" }, a.name),
        h("span", { class: "cp-act-sub" }, a.preds.length ? `after ${a.preds.join(", ")}` : "can start right away", ` · normal ${a.normal} d, crash limit ${a.crashTime} d`),
      ),
      e.critical[i] ? h("span", { class: "cp-chip is-critical" }, "★ critical") : h("span", { class: "cp-chip" }, `slack ${e.slack[i]} d`),
      h("div", { class: "cp-act-ctrl" }, h("span", { class: "cp-now" }, h("b", {}, `${e.durations[i]} d`), crash[i] ? h("span", { class: "cp-cut" }, ` (−${crash[i]})`) : null), crashButtons(a, i, "row")),
    );
  }

  function change(i, delta, focusKey) {
    const a = acts[i];
    const next = crash[i] + delta;
    if (next < 0 || next > a.maxCrash) return;
    const before = evaluate(project, crash);
    crash[i] = next;
    selected = i;
    const after = evaluate(project, crash);
    const newPaths = after.paths.filter((p) => p.critical && !before.paths.find((q) => pathText(q) === pathText(p)).critical);
    const extra = newPaths.length ? ` Now also critical: ${newPaths.map(pathText).join(" and ")}.` : "";
    if (delta < 0) {
      message = { tone: "info", text: `Undid one crash day on ${a.id} and got ${usd(a.costPerDay)} back. The project takes ${days(after.duration)}.` };
    } else if (after.duration < before.duration) {
      const saved = before.indirect + before.penalty - after.indirect - after.penalty;
      const net = a.costPerDay - saved;
      message = {
        tone: net < 0 ? "good" : "warn",
        text: `Crashed ${a.id}: the project is down to ${days(after.duration)}. That day cost ${usd(a.costPerDay)} and saved ${usd(saved)}, so total cost went ${net < 0 ? "down" : net > 0 ? "up" : "nowhere"}${net ? ` by ${usd(Math.abs(net))}` : ""}.${extra}`,
      };
    } else if (!before.critical[i]) {
      message = { tone: "bad", text: `${a.id} had slack, so the project still takes ${days(after.duration)}. That ${usd(a.costPerDay)} bought nothing. Only critical activities shorten the project.` };
    } else {
      message = {
        tone: "bad",
        text: `${a.id} is critical, but another critical path is just as long, so the project still takes ${days(after.duration)}. Shorten every critical path, or an activity they share.`,
      };
    }
    ctx.announce(message.text);
    render(focusKey);
  }

  function reset() {
    crash.fill(0);
    message = { tone: "info", text: `Back to the normal plan: ${days(normal.duration)}, ${usd(normal.total)}.` };
    ctx.announce(message.text);
    render();
  }

  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => render(), 150);
  };
  window.addEventListener("resize", onResize);
  ctx.onCleanup(() => {
    clearTimeout(resizeTimer);
    window.removeEventListener("resize", onResize);
  });

  render();
}

function metric(label, value, state, note) {
  return h(
    "div",
    { class: "g-metric", dataset: state ? { state } : {} },
    h("span", { class: "g-metric-label" }, label),
    h("span", { class: "g-metric-value" }, value),
    note ? h("span", { class: "cp-metric-note" }, note) : null,
  );
}

function legend() {
  return h(
    "p",
    { class: "cp-legend" },
    h("span", { class: "cp-key is-critical" }),
    " thick border and arrow, ★ = critical (no slack)   ",
    h("span", { class: "cp-key" }),
    " thin, dashed arrow = has slack. The number is the activity's days. Tap a box to select it.",
  );
}

function netWidth(el) {
  const w = el && el.clientWidth ? el.clientWidth - 18 : 700;
  return Math.round(Math.min(760, Math.max(300, w)));
}

// ---------------------------------------------------------------- network

/** Activity-on-node diagram. opts.onPick(i) makes boxes clickable (mouse shortcut for "crash 1 day"). */
function drawNetwork(project, e, opts) {
  const { acts } = project;
  const W = opts.width;
  const pad = 8;
  const cols = Math.max(...acts.map((a) => a.col));
  const rows = Math.max(...acts.map((a) => a.row));
  const nodeW = Math.max(54, Math.min(112, (W - 2 * pad) / (cols + 1) - 20));
  const nodeH = 52;
  const colStep = (W - 2 * pad - nodeW) / cols;
  const rowStep = 70;
  const H = rows * rowStep + nodeH + 2 * pad;
  const nx = (a) => pad + a.col * colStep;
  const ny = (a) => pad + a.row * rowStep;
  const idx = new Map(acts.map((a, i) => [a.id, i]));
  const els = [
    svg(
      "defs",
      {},
      svg("marker", { id: "cp-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { d: "M0,1 L10,5 L0,9 z", class: "cp-arrowhead" })),
      svg("marker", { id: "cp-arrow-crit", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" }, svg("path", { d: "M0,1 L10,5 L0,9 z", class: "cp-arrowhead is-critical" })),
    ),
  ];
  // Edges first, so boxes sit on top.
  acts.forEach((a, i) => {
    a.preds.forEach((pid) => {
      const j = idx.get(pid);
      const p = acts[j];
      const tight = e.critical[i] && e.critical[j] && e.ef[j] === e.es[i];
      const x1 = nx(p) + nodeW;
      const y1 = ny(p) + nodeH / 2;
      const x2 = nx(a);
      const y2 = ny(a) + nodeH / 2;
      els.push(svg("line", { x1, y1, x2: x2 - 1, y2, class: `cp-edge${tight ? " is-critical" : ""}`, "marker-end": `url(#${tight ? "cp-arrow-crit" : "cp-arrow"})` }));
    });
  });
  acts.forEach((a, i) => {
    const crit = e.critical[i];
    const cut = e.crash[i];
    const about = `${a.id}: ${a.name}. ${e.durations[i]} days${cut ? ` (crashed ${cut})` : ""}. ${crit ? "Critical." : `Slack ${e.slack[i]} days.`}`;
    const pick = opts.onPick
      ? {
          tabindex: "0",
          role: "button",
          "aria-label": `Select ${about}`,
          "aria-pressed": String(opts.selected === i),
          dataset: { fk: `node-${i}` },
          onclick: () => opts.onPick(i),
          onkeydown: (ev) => {
            if (ev.key !== "Enter" && ev.key !== " ") return;
            ev.preventDefault();
            opts.onPick(i);
          },
        }
      : {};
    const g = svg(
      "g",
      { class: `cp-node${crit ? " is-critical" : ""}${opts.onPick ? " is-pickable" : ""}${opts.selected === i ? " is-selected" : ""}`, transform: `translate(${nx(a)},${ny(a)})`, ...pick },
      svg("title", {}, about),
      opts.selected === i ? svg("rect", { x: -4, y: -4, width: nodeW + 8, height: nodeH + 8, rx: 11, class: "cp-node-ring" }) : null,
      svg("rect", { width: nodeW, height: nodeH, rx: 8, class: "cp-node-box" }),
      svg("text", { x: nodeW / 2, y: 18, class: "cp-node-id" }, crit ? `★ ${a.id}` : a.id),
      svg("text", { x: nodeW / 2, y: 33, class: "cp-node-days" }, cut ? `${a.normal}→${e.durations[i]} d` : `${e.durations[i]} d`),
      svg("text", { x: nodeW / 2, y: 46, class: "cp-node-slack" }, crit ? "critical" : `slack ${e.slack[i]}`),
    );
    els.push(g);
  });
  const critical = e.paths.filter((p) => p.critical).map(pathText);
  const label = `Project network with ${acts.length} activities. Project length ${e.duration} days. Critical path${critical.length > 1 ? "s" : ""}: ${critical.join("; ")}.`;
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "cp-net", role: opts.onPick ? "group" : "img", "aria-label": label }, els);
}

// ---------------------------------------------------------------- results

function planText(project, crash) {
  const parts = project.acts.map((a, i) => (crash[i] ? `${a.id} −${crash[i]}` : null)).filter(Boolean);
  return parts.length ? parts.join(", ") : "none";
}

function showResults(ctx, project, crash) {
  const you = evaluate(project, crash);
  const solved = solve(project);
  const best = evaluate(project, solved.best.crash);
  const normal = evaluate(project, project.acts.map(() => 0));
  const stars = starsFor(you.total, best.total, normal.total);
  const steps = marginalSteps(project, solved.curve);
  const cheapestForYours = solved.curve.find((c) => c.duration === you.duration);
  const wasted = you.crashCost - cheapestForYours.crashCost;
  const saved = normal.total - you.total;
  const possible = normal.total - best.total;
  const hasDeadline = project.deadline != null;

  let headline;
  if (stars === 3) headline = `Lowest possible cost: ${days(you.duration)} for ${usd(you.total)}`;
  else if (saved > 0) headline = `You saved ${usd(saved)} of a possible ${usd(possible)}`;
  else if (saved === 0) headline = "No saving: same cost as not crashing";
  else headline = `Crashing cost ${usd(-saved)} more than it saved`;

  const wastedText =
    wasted > 0
      ? ` You reached ${days(you.duration)} with ${usd(you.crashCost)} of crashing, but the cheapest way to reach ${days(you.duration)} costs ${usd(cheapestForYours.crashCost)}: ${usd(wasted)} went to days that didn't shorten the project or to pricier activities.`
      : you.crashCost > 0
        ? ` You reached ${days(you.duration)} the cheapest possible way.`
        : "";

  const cols = [you, best, normal];
  const rows = [
    { label: "Project length", values: cols.map((c) => days(c.duration)) },
    { label: "Days crashed", values: cols.map((c) => planText(project, c.crash)) },
    { label: "Crash cost", values: cols.map((c) => usd(c.crashCost)) },
    { label: "Indirect cost", values: cols.map((c) => usd(c.indirect)) },
  ];
  if (hasDeadline) rows.push({ label: `Late penalty (deadline day ${project.deadline})`, values: cols.map((c) => usd(c.penalty)) });
  rows.push({ label: "Total cost", values: cols.map((c) => h("b", {}, usd(c.total))) });

  ctx.finish({
    outcome: stars === 3 ? "win" : stars === 0 ? "miss" : "ok",
    stars,
    headline,
    summary: `Without crashing, the project takes ${days(normal.duration)} and costs ${usd(normal.total)}. Your schedule takes <b>${days(you.duration)}</b> and costs <b>${usd(you.total)}</b>. The lowest possible cost is ${usd(best.total)} at ${days(best.duration)}.${wastedText}`,
    comparison: { caption: "Your schedule compared with the lowest-cost schedule and with not crashing at all", columns: ["You", "Lowest cost", "No crashing"], rows },
    figure: h(
      "div",
      { class: "g-card cp-curve-card" },
      h("h2", { class: "cp-curve-title" }, "Time-cost curve: the cheapest way to reach each project length"),
      drawCurve(project, solved, you, netWidth(document.querySelector(".g-screen")) - 4),
      h(
        "p",
        { class: "cp-legend" },
        h("span", { class: "cp-sym is-crash" }, "■"),
        " Crash cost rises as the project gets shorter. ",
        h("span", { class: "cp-sym is-time" }, "▲"),
        hasDeadline ? " Indirect cost plus late penalty falls. " : " Indirect cost falls. ",
        h("span", { class: "cp-sym is-total" }, "●"),
        " Total cost is lowest where they balance: the ★. The ◆ is your schedule.",
      ),
    ),
    debrief: debrief(project, { you, best, normal, solved, steps }),
  });
}

function drawCurve(project, solved, you, width) {
  const W = Math.round(Math.min(720, Math.max(300, width)));
  const H = 280;
  const left = 56;
  const right = 18;
  const top = 26;
  const bottom = 40;
  const { curve, best } = solved;
  const d0 = curve[0].duration;
  const d1 = curve[curve.length - 1].duration;
  const maxY = Math.max(you.total, ...curve.map((c) => c.total)) * 1.18;
  const x = (d) => left + ((d - d0) / Math.max(1, d1 - d0)) * (W - left - right);
  const y = (v) => top + (1 - v / maxY) * (H - top - bottom);
  const els = [];
  // y grid
  const step = niceStep(maxY / 4);
  for (let v = 0; v <= maxY; v += step) {
    els.push(svg("line", { x1: left, x2: W - right, y1: y(v), y2: y(v), class: "cp-grid" }));
    els.push(svg("text", { x: left - 6, y: y(v) + 4, class: "cp-axis-num", "text-anchor": "end" }, v >= 1000 ? `$${v / 1000}k` : `$${v}`));
  }
  const everyOther = curve.length > 12;
  curve.forEach((c, i) => {
    if (!everyOther || (c.duration - d0) % 2 === 0) els.push(svg("text", { x: x(c.duration), y: H - bottom + 15, class: "cp-axis-num", "text-anchor": "middle" }, c.duration));
    els.push(svg("line", { x1: x(c.duration), x2: x(c.duration), y1: H - bottom, y2: H - bottom + 4, class: "cp-grid" }));
  });
  els.push(svg("text", { x: (left + W - right) / 2, y: H - 6, class: "cp-axis-title", "text-anchor": "middle" }, "Project length (days)"));
  if (project.deadline != null && project.deadline >= d0 && project.deadline <= d1) {
    els.push(svg("line", { x1: x(project.deadline), x2: x(project.deadline), y1: top - 6, y2: H - bottom, class: "cp-deadline" }));
    els.push(svg("text", { x: x(project.deadline) + 4, y: top - 10, class: "cp-axis-num" }, "deadline"));
  }
  const line = (key, cls) => els.push(svg("path", { d: curve.map((c, i) => `${i ? "L" : "M"}${x(c.duration).toFixed(1)},${y(key(c)).toFixed(1)}`).join(""), class: `cp-line ${cls}` }));
  const time = (c) => c.indirect + c.penalty;
  line((c) => c.crashCost, "is-crash");
  line(time, "is-time");
  line((c) => c.total, "is-total");
  curve.forEach((c) => {
    els.push(svg("rect", { x: x(c.duration) - 3.5, y: y(c.crashCost) - 3.5, width: 7, height: 7, class: "cp-pt is-crash" }));
    els.push(svg("path", { d: `M${x(c.duration)},${y(time(c)) - 4.5} l4.5,8 l-9,0 z`, class: "cp-pt is-time" }));
    els.push(svg("circle", { cx: x(c.duration), cy: y(c.total), r: 4, class: "cp-pt is-total" }));
  });
  // Optimum (star) and the player's schedule (diamond).
  const bx = x(best.duration);
  const by = y(best.total);
  const yx = x(you.duration);
  const yy = y(you.total);
  const same = you.total === best.total && you.duration === best.duration;
  // Labels sit beside their points, on opposite sides, and are nudged apart if they still collide.
  const textWidth = (t) => t.length * 6.8;
  const place = (px, py, text, dir) => {
    let x0 = dir < 0 ? px - 12 - textWidth(text) : px + 12;
    if (x0 < left + 2) x0 = px + 12;
    if (x0 + textWidth(text) > W - 2) x0 = px - 12 - textWidth(text);
    return { x: x0, y: py, w: textWidth(text), text };
  };
  const bestLabel = place(bx, by - 10, same ? `★ ◆ you: ${usd(best.total)}` : `★ lowest ${usd(best.total)}`, yx >= bx ? -1 : 1);
  const youLabel = place(yx, yy + 4, `◆ you ${usd(you.total)}`, yx >= bx ? 1 : -1);
  if (Math.abs(youLabel.y - bestLabel.y) < 14 && youLabel.x < bestLabel.x + bestLabel.w && bestLabel.x < youLabel.x + youLabel.w) youLabel.y = bestLabel.y - 15;
  els.push(svg("path", { d: `M${yx},${yy - 8} l8,8 l-8,8 l-8,-8 z`, class: "cp-you" }));
  els.push(svg("text", { x: bestLabel.x, y: bestLabel.y, class: "cp-mark is-best" }, bestLabel.text));
  if (!same) els.push(svg("text", { x: youLabel.x, y: youLabel.y, class: "cp-mark is-you" }, youLabel.text));
  const label = `Time-cost curve from ${d0} to ${d1} days. Total cost is lowest, ${usd(best.total)}, at ${best.duration} days. Your schedule: ${you.duration} days, ${usd(you.total)}.`;
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "cp-curve", role: "img", "aria-label": label }, els);
}

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

function debrief(project, { you, best, normal, solved, steps }) {
  const out = [];
  const longest = [...normal.paths].sort((a, b) => b.length - a.length);
  const critical = longest[0];
  const mostSlack = project.acts.map((a, i) => ({ a, slack: normal.slack[i] })).sort((p, q) => q.slack - p.slack)[0];
  out.push({
    title: "Critical path and slack",
    body: h(
      "div",
      {},
      h("p", {}, `Add up the days along every path from start to finish. The longest one is the critical path, and it sets the project length. In the normal plan:`),
      h(
        "ul",
        { class: "cp-path-list" },
        longest.map((p) => h("li", { class: p.critical ? "is-critical" : null }, h("span", { class: "cp-path-ids" }, pathText(p)), h("span", { class: "cp-path-len" }, days(p.length)), p.critical ? h("span", { class: "cp-chip is-critical" }, "★ critical") : h("span", { class: "cp-chip" }, `${days(normal.duration - p.length)} spare`))),
      ),
      h(
        "p",
        {},
        `So the project takes ${days(normal.duration)} because of ${pathText(critical)}. `,
        mostSlack.slack > 0
          ? `Activity ${mostSlack.a.id} (${mostSlack.a.name}) had ${days(mostSlack.slack)} of slack: it could slip that long without delaying anything, and crashing it buys nothing.`
          : "",
      ),
    ),
  });

  const stop = steps.find((s) => !s.worth);
  out.push({
    title: "Crash the cheapest critical day first",
    body: h(
      "div",
      {},
      h("p", {}, "Take the project down one day at a time. Each time, find the cheapest way to shorten every critical path by a day, and compare its cost with what a day saves."),
      h(
        "div",
        { class: "g-table-wrap" },
        h(
          "table",
          { class: "g-table cp-steps" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Shorten"), h("th", { scope: "col" }, "Cheapest way costs"), h("th", { scope: "col" }, "That day saves"), h("th", { scope: "col" }, "Worth it?"))),
          h(
            "tbody",
            {},
            steps.map((s) =>
              h(
                "tr",
                { class: s.to === best.duration && s.worth ? "is-best" : null },
                h("th", { scope: "row" }, `${s.from} → ${s.to} days`),
                h("td", {}, usd(s.costs)),
                h("td", {}, usd(s.saves)),
                h("td", {}, s.costs < s.saves ? "✔ yes" : s.costs === s.saves ? "= break-even" : "✖ no"),
              ),
            ),
          ),
        ),
      ),
      h(
        "p",
        {},
        stop
          ? `Each extra day costs more than the one before, because the cheap days get used up. Stop when the next day costs more than it saves: here, going from ${stop.from} to ${stop.to} days costs ${usd(stop.costs)} but saves only ${usd(stop.saves)}. `
          : "Here every day that can be bought is worth buying, so the best plan crashes all the way. ",
        `The lowest-cost plan is ${days(best.duration)}: crash ${planText(project, best.crash)}.`,
      ),
    ),
  });

  const critBefore = normal.paths.filter((p) => p.critical);
  const critAfter = best.paths.filter((p) => p.critical);
  out.push({
    title: "New critical paths appear",
    body: `<p>As the critical path gets shorter, other paths catch up. In the normal plan ${critBefore.length === 1 ? "one path was" : `${critBefore.length} paths were`} critical. In the lowest-cost plan ${
      critAfter.length === 1 ? `it is still the only one: ${pathText(critAfter[0])}` : `${critAfter.length} paths are critical, each ${days(best.duration)} long: ${critAfter.map(pathText).join("; ")}`
    }.</p><p>${
      critAfter.length > 1
        ? "Once two paths are critical, shortening only one of them does nothing. You have to take a day off each, or off an activity they share. That is why later days cost more."
        : "The other paths still had slack, so here you never had to crash two activities for the same day. In the next level, parallel paths catch up."
    }</p>`,
  });

  if (project.deadline != null) {
    out.push({
      title: "Deadlines and penalties",
      body: `<p>While the project is late, each day you remove saves the indirect cost <i>and</i> the penalty: ${usd(project.indirect)} + ${usd(project.penalty)} = ${usd(
        savingPerDay(project, project.deadline + 1),
      )}. Once you are on time, a day saves only ${usd(project.indirect)}. So expensive crashing can be worth it to meet the deadline, and not worth it to beat it.</p><p>The lowest-cost plan finishes on day ${best.duration}, ${
        best.late > 0 ? `${days(best.late)} late: the last days were too expensive to buy, so paying the penalty is cheaper` : best.duration === project.deadline ? "exactly on the deadline" : `${days(project.deadline - best.duration)} early`
      }. Your plan finishes on day ${you.duration}${you.late > 0 ? ` (${days(you.late)} late, ${usd(you.penalty)} in penalties)` : ""}.</p>`,
    });
  }
  return out;
}
