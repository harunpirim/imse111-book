// Build for Uptime: build a block diagram from parts in series and parallel,
// keep it within budget, then run many missions to see how often it fails.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt } from "../shared/dom.js";
import {
  ASSUMPTIONS,
  LEVELS,
  MISSIONS,
  K_NEEDED,
  generateLevel,
  evaluate,
  stageReliability,
  stageFormula,
  cheapestDesign,
  simulate,
  starsFor,
  usd,
} from "./logic.js";

const r2 = (x) => fmt(x, 2);
const r3 = (x) => fmt(x, 3);
const pct1 = (x) => `${fmt(100 * x, 1)}%`;
const TIERS = ["●○○", "●●○", "●●●"]; // basic, standard, premium: shape, not just color
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function start(ctx) {
  const level = generateLevel(ctx.rng, ctx.level);
  const design = level.stages.map(() => []);
  let runs = 0;
  let lastRun = null;
  let timer = null;
  ctx.onCleanup(() => clearInterval(timer));

  ctx.setStatus(
    h(
      "p",
      { class: "bu-brief" },
      h("strong", {}, `${ctx.level.name}: `),
      `build ${level.system}. It must keep working for ${level.mission}. Budget `,
      h("strong", {}, usd(level.budget)),
      ", target reliability ",
      h("strong", {}, r2(level.target)),
      ` (it completes ${fmt(level.target * 100, 0)} of 100 missions).`,
    ),
  );

  const metricsEl = h("div", { class: "g-metrics bu-metrics", "aria-label": "System summary" });
  const diagramEl = h("div", { class: "bu-diagram-wrap" });
  const shelfEl = h("div", { class: "bu-shelf" });
  const footEl = h("div", { class: "bu-foot" });
  const logEl = h("div", { class: "bu-log-wrap" });
  replace(
    ctx.stage,
    metricsEl,
    h("section", { class: "g-card bu-diagram-card", "aria-label": "Block diagram" }, h("h2", { class: "bu-h" }, "Block diagram: stages in series, spares in parallel"), diagramEl),
    h("section", { class: "bu-shelf-card", "aria-label": "Parts shelf" }, h("h2", { class: "bu-h" }, "Parts shelf: drag a part into its stage, or tap it"), shelfEl),
    footEl,
    logEl,
  );

  function add(si, pi, focusKey) {
    const st = level.stages[si];
    const part = st.parts[pi];
    if (st.max === 1) design[si] = [pi];
    else if (design[si].length >= st.max) {
      ctx.announce(`The ${st.name} stage is full.`);
      return;
    } else design[si].push(pi);
    lastRun = null;
    render(focusKey);
    const e = evaluate(level, design);
    ctx.announce(`${part.name} added to ${st.name}. Stage reliability ${r3(e.stageR[si])}. System ${e.complete ? r3(e.reliability) : "not complete"}. Cost ${usd(e.cost)}.`);
  }

  function remove(si, ui) {
    const st = level.stages[si];
    const [pi] = design[si].splice(ui, 1);
    lastRun = null;
    render(`stage-${si}`);
    ctx.announce(`${st.parts[pi].name} removed from ${st.name}.`);
  }

  function metric(label, value, state) {
    return h("div", { class: "g-metric", dataset: state ? { state } : {} }, h("span", { class: "g-metric-label" }, label), h("span", { class: "g-metric-value" }, value));
  }

  function stageBlock(st, si, e) {
    const units = design[si];
    const full = units.length >= st.max;
    const need = st.need || 1;
    const el = h(
      "section",
      {
        class: `bu-stage${e.weakest === si && level.stages.length > 1 ? " is-weakest" : ""}${units.length < need ? " is-empty" : ""}`,
        tabindex: "-1",
        dataset: { key: `stage-${si}` },
        "aria-label": `${st.name} stage, ${plural(units.length, "unit")}${need > 1 ? `, needs ${need} working` : ""}, reliability ${units.length >= need ? r3(e.stageR[si]) : "none yet"}`,
      },
      h("h3", { class: "bu-stage-name" }, st.name, need > 1 ? h("span", { class: "bu-need" }, ` needs ${need} of them`) : null),
      h(
        "div",
        { class: "bu-rail" },
        units.map((pi, ui) =>
          h(
            "button",
            {
              type: "button",
              class: `bu-unit bu-tier-${pi}`,
              dataset: { key: `unit-${si}-${ui}` },
              "aria-label": `Remove ${st.parts[pi].name}, reliability ${r2(st.parts[pi].r)}, from ${st.name}`,
              title: "Remove this unit",
              onclick: () => remove(si, ui),
            },
            h("span", { class: "bu-unit-name" }, h("span", { class: "bu-part-tier", "aria-hidden": "true" }, TIERS[pi]), " ", st.parts[pi].name),
            h("span", { class: "bu-unit-r" }, r2(st.parts[pi].r)),
            h("span", { class: "bu-unit-x", "aria-hidden": "true" }, "×"),
          ),
        ),
        full ? null : h("div", { class: "bu-slot" }, units.length < need ? `drop a ${st.name.toLowerCase()} here` : st.max === 1 ? "" : "+ spare"),
      ),
      h(
        "p",
        { class: "bu-stage-r" },
        units.length >= need ? `Stage ${r3(e.stageR[si])}` : "Not working yet",
        e.weakest === si && level.stages.length > 1 ? h("span", { class: "bu-tag" }, "▼ weakest") : null,
      ),
      units.length > 1 || need > 1 ? h("p", { class: "bu-stage-f" }, stageFormula(st, units)) : null,
    );
    el.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      el.classList.add("is-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("is-over"));
    el.addEventListener("drop", (ev) => {
      ev.preventDefault();
      el.classList.remove("is-over");
      const [s, p] = (ev.dataTransfer.getData("text/plain") || "").split(":").map(Number);
      if (!Number.isInteger(s) || !Number.isInteger(p) || !level.stages[s] || !level.stages[s].parts[p]) return;
      if (s !== si) ctx.announce(`That part belongs in the ${level.stages[s].name} stage. Added it there.`);
      add(s, p);
    });
    return el;
  }

  function render(focusKey) {
    const key = focusKey || document.activeElement?.dataset?.key;
    const e = evaluate(level, design);
    const left = level.budget - e.cost;

    replace(
      metricsEl,
      metric("System reliability", e.complete ? r3(e.reliability) : "-", e.complete ? (e.meetsTarget ? "good" : "warn") : null),
      metric("Target", `≥ ${r2(level.target)}`),
      metric("Cost", usd(e.cost), e.withinBudget ? null : "bad"),
      metric("Budget left", left >= 0 ? usd(left) : `−${usd(-left)}`, left < 0 ? "bad" : null),
      metric(`Expected failures in ${MISSIONS}`, e.complete ? fmt(MISSIONS * (1 - e.reliability), 0) : "-"),
    );

    const chain = [h("div", { class: "bu-end", "aria-hidden": "true" }, "IN")];
    level.stages.forEach((st, si) => {
      chain.push(h("div", { class: "bu-wire", "aria-hidden": "true" }), stageBlock(st, si, e));
    });
    chain.push(h("div", { class: "bu-wire", "aria-hidden": "true" }), h("div", { class: "bu-end", "aria-hidden": "true" }, "OUT"));
    replace(
      diagramEl,
      h("div", { class: "bu-diagram" }, chain),
      h(
        "p",
        { class: "g-formula bu-system" },
        e.complete ? `System = ${e.stageR.map(r3).join(" × ")} = ${r3(e.reliability)}` : "System = every stage must work. Fill each stage to see the number.",
      ),
    );

    replace(
      shelfEl,
      level.stages.map((st, si) =>
        h(
          "div",
          { class: "bu-shelf-row", role: "group", "aria-label": `${st.name} parts` },
          h("h3", { class: "bu-shelf-name" }, st.name),
          h(
            "div",
            { class: "bu-parts" },
            st.parts.map((part, pi) => {
              const full = st.max > 1 && design[si].length >= st.max;
              return h(
                "button",
                {
                  type: "button",
                  class: `bu-part bu-tier-${pi}`,
                  draggable: "true",
                  disabled: full ? true : null,
                  dataset: { key: `part-${si}-${pi}` },
                  "aria-label": `${st.max === 1 && design[si].length ? "Swap in" : "Add"} ${part.name}: reliability ${r2(part.r)}, ${usd(part.cost)}${full ? ". Stage is full" : ""}`,
                  onclick: () => add(si, pi, `part-${si}-${pi}`),
                  ondragstart: (ev) => {
                    ev.dataTransfer.setData("text/plain", `${si}:${pi}`);
                    ev.dataTransfer.effectAllowed = "copy";
                  },
                },
                h("span", { class: "bu-part-tier", "aria-hidden": "true" }, TIERS[pi]),
                h("span", { class: "bu-part-name" }, part.name),
                h("span", { class: "bu-part-nums" }, h("span", { class: "bu-part-r" }, `works ${r2(part.r)}`), h("span", { class: "bu-part-cost" }, usd(part.cost))),
              );
            }),
          ),
        ),
      ),
    );

    const problems = [];
    e.missing.forEach((m, i) => m && problems.push(`${level.stages[i].name} needs ${m === 1 ? "a part" : `${m} more parts`}`));
    if (!e.withinBudget) problems.push(`${usd(-left)} over budget`);
    const ready = e.complete && e.withinBudget;
    replace(
      footEl,
      h(
        "div",
        { class: "g-actions" },
        h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", dataset: { key: "run" }, disabled: ready ? null : true, onclick: run }, `Run ${MISSIONS} missions`),
        h(
          "button",
          {
            type: "button",
            class: "g-btn g-btn-ghost",
            dataset: { key: "clear" },
            onclick: () => {
              design.forEach((d) => (d.length = 0));
              lastRun = null;
              render("clear");
            },
          },
          "Clear all",
        ),
      ),
      h(
        "p",
        { class: `bu-note${ready && e.meetsTarget ? " is-ok" : ""}`, role: "note" },
        problems.length
          ? `To run: ${problems.join(" · ")}.`
          : e.meetsTarget
            ? "Target met. Run the missions, or try to squeeze out more reliability."
            : `Reliability ${r3(e.reliability)} is below the target of ${r2(level.target)}. You can run it, or improve the weakest stage first.`,
      ),
    );
    if (!lastRun) replace(logEl);
    if (key) ctx.stage.querySelector(`[data-key="${key}"]`)?.focus({ preventScroll: true });
  }

  function run() {
    const e = evaluate(level, design);
    if (!e.complete || !e.withinBudget) return;
    clearInterval(timer);
    runs += 1;
    const sim = simulate(level, design, ctx.rng.fork(`run-${runs}`));
    lastRun = sim;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let shown = reduce ? MISSIONS : 0;
    const head = h("h2", { class: "bu-h", tabindex: "-1" }, `Mission log: run ${runs}`);
    const gridEl = h("div", {});
    const doneEl = h("div", {});
    replace(logEl, h("section", { class: "g-card bu-log", "aria-label": "Mission log" }, head, gridEl, doneEl));
    const draw = () => {
      replace(gridEl, missionGrid(sim, shown, level));
      if (shown < MISSIONS) return;
      clearInterval(timer);
      const expected = MISSIONS * (1 - e.reliability);
      const byStage = level.stages.map((st, i) => (sim.failsByStage[i] ? `${st.name} ${sim.failsByStage[i]}` : null)).filter(Boolean);
      replace(
        doneEl,
        h(
          "p",
          { class: "bu-log-sum" },
          h("strong", {}, `${sim.successes} of ${MISSIONS} missions completed, ${plural(sim.failures, "failure")}.`),
          ` The calculation expects about ${fmt(expected, 0)}.`,
          byStage.length ? ` Stage failures: ${byStage.join(", ")}.` : "",
        ),
        h(
          "div",
          { class: "g-actions" },
          h("button", { type: "button", class: "g-btn g-btn-primary", dataset: { key: "finish" }, onclick: () => finish(sim) }, "See results"),
          h(
            "button",
            {
              type: "button",
              class: "g-btn",
              onclick: () => {
                lastRun = null;
                render("run");
              },
            },
            "Keep building",
          ),
        ),
      );
      doneEl.querySelector("[data-key=finish]")?.focus({ preventScroll: true });
      ctx.announce(`${sim.successes} of ${MISSIONS} missions completed, ${plural(sim.failures, "failure")}.`);
    };
    draw();
    if (!reduce) {
      timer = setInterval(() => {
        shown = Math.min(MISSIONS, shown + 10);
        draw();
      }, 60);
    }
    head.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }

  function finish(sim) {
    const mine = evaluate(level, design);
    const best = evaluate(level, level.best.design);
    const cheapD = cheapestDesign(level);
    const cheap = evaluate(level, cheapD);
    const bestSim = simulate(level, level.best.design, ctx.rng.fork("best"));
    const cheapSim = simulate(level, cheapD, ctx.rng.fork("cheapest"));
    const stars = starsFor(mine, level.best);
    const cols = [
      { e: mine, s: sim },
      { e: cheap, s: cheapSim },
      { e: best, s: bestSim },
    ];
    const row = (label, fn) => ({ label, values: cols.map(fn) });

    ctx.finish({
      outcome: stars === 3 ? "win" : stars === 2 ? "ok" : "miss",
      stars,
      headline:
        stars === 3
          ? `Reliability ${r3(mine.reliability)}: the best the budget allows`
          : stars === 2
            ? `Target met with ${r3(mine.reliability)}; ${r3(best.reliability)} was possible`
            : `Reliability ${r3(mine.reliability)}, below the ${r2(level.target)} target`,
      summary: `Your system should complete <b>${pct1(mine.reliability)}</b> of its missions. In ${MISSIONS} simulated missions it failed <b>${sim.failures}</b> times; the calculation expects about ${fmt(MISSIONS * (1 - mine.reliability), 0)}. You spent ${usd(mine.cost)} of ${usd(level.budget)}.`,
      comparison: {
        caption: "Your design, the cheapest working design, and the most reliable design within budget",
        columns: ["You", "Cheapest parts, no spares", "Best within budget"],
        rows: [
          row("System reliability", (c) => r3(c.e.reliability)),
          row("Cost", (c) => usd(c.e.cost)),
          row("Units installed", (c) => String(c.e.units)),
          row(`Expected failures in ${MISSIONS}`, (c) => fmt(MISSIONS * (1 - c.e.reliability), 1)),
          row(`Simulated failures in ${MISSIONS}`, (c) => String(c.s.failures)),
          ...level.stages.map((st, i) => row(`${st.name} stage`, (c) => r3(c.e.stageR[i]))),
        ],
      },
      figure: h(
        "div",
        { class: "bu-result-fig" },
        h("figure", { class: "bu-fig" }, missionGrid(sim, MISSIONS, level), h("figcaption", {}, `Your design: ${plural(sim.failures, "failure")} in ${MISSIONS} missions`), designList(level, design)),
        h(
          "figure",
          { class: "bu-fig" },
          missionGrid(bestSim, MISSIONS, level),
          h("figcaption", {}, `Best within budget: ${plural(bestSim.failures, "failure")} in ${MISSIONS} missions`),
          designList(level, level.best.design),
        ),
      ),
      debrief: debrief(level, design, mine, best, sim),
    });
  }

  render();
}

/** A stage's units in words: "2 × Rebuilt pump (0.99)". */
function designList(level, design) {
  return h(
    "ul",
    { class: "bu-design-list" },
    level.stages.map((st, i) => {
      const counts = new Map();
      design[i].forEach((p) => counts.set(p, (counts.get(p) || 0) + 1));
      const text = [...counts.entries()].map(([p, n]) => `${n > 1 ? `${n} × ` : ""}${st.parts[p].name}`).join(" + ");
      return h("li", {}, h("b", {}, `${st.name}: `), `${text} `, h("span", { class: "bu-muted" }, `(${r3(stageReliability(st, design[i]))})`));
    }),
  );
}

/** 200 missions as a grid: a filled square completed, a crossed square failed. */
function missionGrid(sim, shown, level) {
  const cols = 25;
  const cell = 12;
  const gap = 2;
  const rows = Math.ceil(sim.missions / cols);
  const W = cols * (cell + gap) - gap;
  const H = rows * (cell + gap) - gap;
  const els = [];
  let fails = 0;
  for (let m = 0; m < sim.missions; m++) {
    const x = (m % cols) * (cell + gap);
    const y = Math.floor(m / cols) * (cell + gap);
    if (m >= shown) {
      els.push(svg("rect", { x, y, width: cell, height: cell, rx: 2, class: "bu-cell bu-cell-wait" }));
    } else if (sim.outcomes[m] < 0) {
      els.push(svg("rect", { x, y, width: cell, height: cell, rx: 2, class: "bu-cell bu-cell-ok" }));
    } else {
      fails++;
      els.push(
        svg("rect", { x, y, width: cell, height: cell, rx: 2, class: "bu-cell bu-cell-fail" }),
        svg("path", { d: `M${x + 3},${y + 3} l${cell - 6},${cell - 6} M${x + cell - 3},${y + 3} l${-(cell - 6)},${cell - 6}`, class: "bu-cell-x" }),
      );
    }
  }
  return h(
    "div",
    { class: "bu-grid" },
    svg(
      "svg",
      {
        viewBox: `0 0 ${W} ${H}`,
        role: "img",
        "aria-label": `${Math.min(shown, sim.missions)} of ${sim.missions} missions shown: ${fails} failed. Failures by stage: ${level.stages.map((st, i) => `${st.name} ${sim.failsByStage[i]}`).join(", ")}.`,
      },
      els,
    ),
    h(
      "p",
      { class: "bu-grid-key", "aria-hidden": "true" },
      h("span", { class: "bu-key bu-key-ok" }),
      "completed ",
      h("span", { class: "bu-key bu-key-fail" }, "×"),
      "failed",
    ),
  );
}

function debrief(level, design, mine, best, sim) {
  const stages = level.stages;
  // A stage to explain "parallel" with: the player's first stage with a spare, else one from the best design.
  let pd = design;
  let pi = design.findIndex((d, i) => d.length > 1 && (stages[i].need || 1) === 1);
  if (pi < 0) {
    pd = level.best.design;
    pi = pd.findIndex((d, i) => d.length > 1 && (stages[i].need || 1) === 1);
  }
  const who = pd === design ? "your" : "the best design's";
  const sections = [
    {
      title: "Series: multiply the reliabilities",
      body: h(
        "div",
        {},
        h("p", { class: "g-formula" }, `R(system) = ${stages.map((s) => s.name).join(" × ")} = ${mine.stageR.map(r3).join(" × ")} = ${r3(mine.reliability)}`),
        h(
          "p",
          {},
          `The system needs every stage, so one failed stage stops the mission. Multiplying numbers below 1 always gives something smaller: your system (${r3(mine.reliability)}) is less reliable than its weakest stage, ${stages[mine.weakest].name} (${r3(mine.stageR[mine.weakest])}). The more stages in a row, the worse it gets.`,
        ),
      ),
    },
  ];

  if (pi >= 0) {
    const st = stages[pi];
    const units = pd[pi];
    sections.push({
      title: "Parallel: multiply the chances of failure",
      body: h(
        "div",
        {},
        h("p", { class: "g-formula" }, `R(${st.name}) = ${stageFormula(st, units)}`),
        h(
          "p",
          {},
          `In ${who} ${st.name} stage, ${plural(units.length, "unit")} share the job, and the stage fails only if all of them fail in the same mission. Each one fails with probability 1 − r, so the stage fails with probability ${units.map((u) => r2(1 - st.parts[u].r)).join(" × ")} = ${fmt(1 - stageReliability(st, units), 4)}.`,
        ),
      ),
    });
  } else {
    sections.push({
      title: "Parallel: multiply the chances of failure",
      body: `<p>This level allowed no spares. With a spare, a stage fails only if <b>both</b> units fail: two units of reliability 0.90 give 1 − 0.10 × 0.10 = 0.99. Try the next level to use it.</p>`,
    });
  }

  // Diminishing returns, using the cheapest part of the player's weakest stage.
  const ws = stages[mine.weakest];
  const p0 = ws.parts[0];
  const rows = [1, 2, 3].map((n) => {
    const r = 1 - (1 - p0.r) ** n;
    const prev = n === 1 ? 0 : 1 - (1 - p0.r) ** (n - 1);
    return `<tr><th scope="row">${n}</th><td>${fmt(r, 4)}</td><td>${n === 1 ? "-" : `+${fmt(r - prev, 4)}`}</td><td>${usd(n * p0.cost)}</td></tr>`;
  });
  sections.push({
    title: "Diminishing returns of redundancy",
    body: `<p>Each extra spare helps less than the one before, but costs the same. For the ${p0.name.toLowerCase()} (reliability ${r2(p0.r)}, ${usd(p0.cost)}):</p>
      <div class="g-table-wrap"><table class="g-table bu-mini"><thead><tr><th scope="col">Units in parallel</th><th scope="col">Stage reliability</th><th scope="col">Gain</th><th scope="col">Cost</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
      <p>The first spare removes most of the risk. After that, the money usually does more good in another stage: the <b>weakest stage</b> is where the next dollar belongs.</p>`,
  });

  const lesson = {
    series: `With no spares allowed, the only choice was which stage gets the better part. The best design spends where a dollar buys the most reliability, and it accepts a cheaper part where the upgrade is poor value.`,
    spare: `Two cheap units in parallel often beat one premium unit and cost less. The best design here uses ${plural(best.units, "unit")} for ${usd(best.cost)}.`,
    tight: `Price is not quality. In this level some premium parts were bargains and others were overpriced, so the best design mixes both ideas: a single premium part in one stage and cheap spares in another.`,
    kofn: `The pump stage needed ${K_NEEDED} pumps working, so two pumps alone behave like a series pair: both must work. A third pump lets the stage survive one failure. This is a ${K_NEEDED}-out-of-n stage: add up the chances of every case where at least ${K_NEEDED} work.`,
  }[level.kind];
  sections.push({
    title: "Calculation and simulation",
    body: `<p>${lesson}</p><p>Your calculated reliability is ${r3(mine.reliability)}, so ${MISSIONS} missions should bring about ${fmt(MISSIONS * (1 - mine.reliability), 1)} failures. The simulation gave ${sim.failures}. They differ because each mission is a roll of the dice. Simulating many missions (a <b>Monte Carlo</b> simulation) gets closer to the calculation as the number of missions grows. The best design within budget reaches ${r3(best.reliability)} for ${usd(best.cost)}.</p>`,
  });
  return sections;
}

// Start last, so every helper above exists even when ?autostart=1 begins a round at once.
createGame({
  slug: "build-for-uptime",
  title: "Build for Uptime",
  tagline: "Make it work, every time, on a budget.",
  objective:
    "compute the reliability of parts in series and in parallel, decide where a spare is worth its cost, and check a calculated reliability against simulated missions.",
  minutes: "10-15",
  chapter: { href: "../../chapters/week-04.html", label: "Week 4 · Engineering Problem Solving and Systems Thinking" },
  howToPlay: [
    "The system needs every <b>stage</b> to work (stages are in <b>series</b>). Each part has a <b>reliability</b>: 0.90 means it works for the whole mission 90 times in 100.",
    "Drag a part from the shelf into its stage, or tap it. A second or third unit in the same stage is a <b>spare in parallel</b>: the stage fails only if all its units fail.",
    "Tap a unit in the diagram to remove it. Stay within the <b>budget</b> and reach the <b>target</b> reliability.",
    `Press <b>Run ${MISSIONS} missions</b> to watch your design succeed and fail, then see how it compares with the most reliable design the budget allows.`,
    "Keyboard: <kbd>Tab</kbd> to a part and press <kbd>Enter</kbd> to add it; <kbd>Tab</kbd> to a unit in the diagram and press <kbd>Enter</kbd> to remove it.",
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start,
});
