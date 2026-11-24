// Invest or Wait: choose which projects to fund, with a limited number of
// analyst hours to spend on payback, NPV, and IRR calculations.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt, pct } from "../shared/dom.js";
import {
  ASSUMPTIONS,
  LEVELS,
  HOURS,
  PAYBACK_CUTOFF,
  pvFactor,
  annuityFactor,
  analyze,
  selectionCost,
  isFeasible,
  oneLifeSelection,
  scoreRound,
  generateRound,
  usd,
} from "./logic.js";

const TOOL_NAMES = { payback: "Payback", npv: "NPV", irr: "IRR" };

const signed = (x) => (Math.abs(x) < 0.5 ? "$0" : `${x < 0 ? "−" : "+"}${usd(Math.abs(x))}`);
const years = (y, life) => (Number.isFinite(y) ? `${fmt(y, 1)} years` : `never (not within its ${life}-year life)`);
const rate = (r) => (r == null ? "negative (it never earns back its cost)" : pct(r, 1));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

createGame({
  slug: "invest-or-wait",
  title: "Invest or Wait",
  tagline: "Money now or money later? Put the plant's capital where it grows most.",
  objective:
    "read a cash flow diagram, judge a project by its net present value (NPV) at the MARR, and explain why the payback period alone can pick the wrong project.",
  minutes: "10-15",
  chapter: { href: "../../chapters/week-15.html", label: "Week 15 · Ethics, Sustainability, and the Future of IME" },
  howToPlay: [
    "You manage a plant's capital budget. Each decision shows one or more projects as <b>cash flow diagrams</b>: a first cost today (arrow down), then savings at the end of every year (arrows up).",
    "<b>Invest</b> in the projects that are worth more than leaving the money alone, where it earns the <b>MARR</b>. Otherwise <b>wait</b>.",
    `Your analyst can work out a project's <b>payback</b> (${HOURS.payback} hour), <b>NPV</b> (${HOURS.npv} hours), or, from level 2, <b>IRR</b> (${HOURS.irr} hours). There aren't enough hours to check everything, so spend them where you're least sure.`,
    "The free <b>discount table</b> under the projects shows what $1 in a later year is worth today. Use it to estimate before you spend hours.",
    "Press <b>Lock in decision</b> to move on. At the end, compare your choices with the best NPV and with payback-only thinking.",
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start,
});

function start(ctx) {
  const game = generateRound(ctx.rng, ctx.level);
  const { deals, marr } = game;
  let k = 0;
  let hoursLeft = game.hours;
  const revealed = deals.map((d) => d.projects.map(() => ({})));
  // null = not decided yet (single and exclusive deals need an explicit choice)
  const choices = deals.map((d) => (d.mode === "independent" && d.projects.length > 1 ? [] : null));
  const maxYear = Math.max(...deals.flatMap((d) => d.projects.map((p) => d.horizon || p.life)));

  function render(focusKey) {
    const deal = deals[k];
    const choice = choices[k];
    const spent = choice ? selectionCost(deal, choice) : 0;
    const single = deal.projects.length === 1;
    const over = spent > deal.budget;

    ctx.setStatus(
      h(
        "div",
        { class: "g-metrics iw-metrics" },
        metric("MARR", pct(marr, 0)),
        metric("Decision", `${k + 1} of ${deals.length}`),
        metric("Analyst hours left", `${hoursLeft} of ${game.hours}`, hoursLeft === 0 ? "warn" : null),
        metric("Budget", usd(deal.budget)),
        metric(over ? "Over budget by" : "Budget left", usd(Math.abs(deal.budget - spent)), over ? "bad" : null),
      ),
    );

    const scale = flowScale(deal);
    const cards = deal.projects.map((p, i) => projectCard(deal, p, i, scale));
    const waitCard =
      deal.mode === "exclusive"
        ? h(
            "label",
            { class: `iw-card iw-wait${choice && choice.length === 0 ? " is-picked" : ""}` },
            h("input", { type: "radio", name: `deal-${k}`, checked: choice && choice.length === 0, dataset: { fk: "pick-none" }, onchange: () => choose([], "pick-none") }),
            h("span", {}, h("b", {}, "None of these: wait"), h("br"), `Keep the ${usd(deal.budget)} earning ${pct(marr, 0)}.`),
          )
        : null;

    const ready = choice !== null && !over;
    const last = k === deals.length - 1;
    replace(
      ctx.stage,
      h("p", { class: "iw-prompt" }, promptFor(deal, marr)),
      h("div", { class: `iw-cards${single ? " is-single" : ""}`, role: deal.mode === "exclusive" ? "radiogroup" : "group", "aria-label": "Projects" }, cards, waitCard),
      h(
        "div",
        { class: "iw-foot" },
        h(
          "button",
          { type: "button", class: "g-btn g-btn-primary g-btn-lg", disabled: !ready, dataset: { fk: "lock" }, onclick: lockIn },
          last ? "Lock in and see results" : "Lock in decision",
        ),
        h(
          "span",
          { class: "iw-foot-note", role: "status" },
          choice === null ? "Choose before you lock in." : over ? `These projects cost ${usd(spent)}, more than the ${usd(deal.budget)} budget.` : describeChoice(deal, choice),
        ),
      ),
      discountTable(marr, maxYear),
    );
    if (focusKey) ctx.stage.querySelector(`[data-fk="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  function choose(picks, focusKey) {
    choices[k] = picks;
    render(focusKey);
  }

  function toggle(i, focusKey) {
    const set = new Set(choices[k] || []);
    if (set.has(i)) set.delete(i);
    else set.add(i);
    choose([...set].sort((a, b) => a - b), focusKey);
  }

  function useTool(i, tool) {
    if (revealed[k][i][tool] || hoursLeft < HOURS[tool]) return;
    hoursLeft -= HOURS[tool];
    revealed[k][i][tool] = true;
    const p = deals[k].projects[i];
    ctx.announce(`${p.name}. ${revealText(deals[k], p, tool)} ${plural(hoursLeft, "analyst hour")} left.`);
    render(`tool-${i}-${tool}`);
  }

  function lockIn() {
    if (choices[k] === null || !isFeasible(deals[k], choices[k])) return;
    if (k < deals.length - 1) {
      k += 1;
      render();
      ctx.stage.scrollIntoView?.({ block: "nearest" });
      ctx.announce(`Decision ${k + 1} of ${deals.length}.`);
      const first = ctx.stage.querySelector("input, button");
      first?.focus({ preventScroll: true });
      return;
    }
    showResults(ctx, game, choices, game.hours - hoursLeft);
  }

  function revealText(deal, p, tool) {
    const a = analyze(p, deal, marr);
    if (a.scenarios) {
      const each = (fn) => a.scenarios.map((s) => `${fn(s)} if ${s.name.toLowerCase()} (${pct(s.p, 0)})`).join(", ");
      if (tool === "payback") return `Payback: ${each((s) => years(s.payback, p.life))}.`;
      if (tool === "npv") return `NPV at ${pct(marr, 0)}: ${each((s) => signed(s.npv))}.`;
      return `IRR: ${each((s) => rate(s.irr))}.`;
    }
    if (tool === "payback") return `Payback: ${years(a.payback, p.life)}.`;
    if (tool === "irr") return `IRR: ${rate(a.irr)}.`;
    if (deal.horizon && deal.horizon !== p.life) {
      const times = deal.horizon / p.life;
      return `NPV of one ${p.life}-year life at ${pct(marr, 0)}: ${signed(a.npv)}. To cover ${deal.horizon} years you buy it ${times} times.`;
    }
    if (deal.horizon) return `NPV at ${pct(marr, 0)} over its ${p.life}-year life: ${signed(a.npv)}.`;
    return `NPV at ${pct(marr, 0)}: ${signed(a.npv)}.`;
  }

  function projectCard(deal, p, i, scale) {
    const choice = choices[k];
    const picked = !!choice && choice.includes(i);
    const single = deal.projects.length === 1;
    let control;
    if (single) {
      control = h(
        "fieldset",
        { class: "iw-yesno" },
        h("legend", { class: "g-sr-only" }, `Decision for ${p.name}`),
        h(
          "label",
          { class: `iw-choice${picked ? " is-on" : ""}` },
          h("input", { type: "radio", name: `deal-${k}`, checked: picked, dataset: { fk: "pick-yes" }, onchange: () => choose([0], "pick-yes") }),
          "Invest",
        ),
        h(
          "label",
          { class: `iw-choice${choice && !picked ? " is-on" : ""}` },
          h("input", { type: "radio", name: `deal-${k}`, checked: choice && !picked, dataset: { fk: "pick-no" }, onchange: () => choose([], "pick-no") }),
          "Wait",
        ),
      );
    } else if (deal.mode === "exclusive") {
      control = h(
        "label",
        { class: `iw-choice${picked ? " is-on" : ""}` },
        h("input", { type: "radio", name: `deal-${k}`, checked: picked, dataset: { fk: `pick-${i}` }, onchange: () => choose([i], `pick-${i}`) }),
        "Fund this one",
      );
    } else {
      control = h(
        "label",
        { class: `iw-choice${picked ? " is-on" : ""}` },
        h("input", { type: "checkbox", checked: picked, dataset: { fk: `pick-${i}` }, onchange: () => toggle(i, `pick-${i}`) }),
        `Fund this project (${usd(p.cost)})`,
      );
    }

    const tools = game.tools.map((tool) => {
      const used = !!revealed[k][i][tool];
      const blocked = !used && hoursLeft < HOURS[tool];
      return h(
        "button",
        {
          type: "button",
          class: `iw-tool${used ? " is-used" : ""}`,
          "aria-disabled": used || blocked ? "true" : null,
          title: blocked ? "Not enough analyst hours left" : null,
          dataset: { fk: `tool-${i}-${tool}` },
          "aria-label": `${TOOL_NAMES[tool]} for ${p.name}, ${plural(HOURS[tool], "hour")}${used ? ", done" : blocked ? ", not enough hours" : ""}`,
          onclick: () => useTool(i, tool),
        },
        h("span", { class: "iw-tool-name" }, used ? `✓ ${TOOL_NAMES[tool]}` : TOOL_NAMES[tool]),
        used ? null : h("span", { class: "iw-tool-cost" }, `${HOURS[tool]} h`),
      );
    });
    const reveals = game.tools.filter((tool) => revealed[k][i][tool]).map((tool) => h("li", {}, revealText(deal, p, tool)));

    return h(
      "article",
      { class: `iw-card${picked ? " is-picked" : ""}` },
      h("h2", { class: "iw-name" }, single ? null : h("span", { class: "iw-id" }, p.id), p.name, picked ? h("span", { class: "iw-badge" }, "✔ Funded") : null),
      flowDiagram(p, deal, scale),
      facts(p, deal),
      h("div", { class: "iw-tools", role: "group", "aria-label": `Analyst calculations for ${p.name}` }, tools),
      reveals.length ? h("ul", { class: "iw-reveals" }, reveals) : null,
      control,
    );
  }

  render();
}

function metric(label, value, state) {
  return h("div", { class: "g-metric", dataset: state ? { state } : {} }, h("span", { class: "g-metric-label" }, label), h("span", { class: "g-metric-value" }, value));
}

function promptFor(deal, marr) {
  const budget = usd(deal.budget);
  if (deal.projects.length === 1) return `You have ${budget} for this decision. Invest in the project, or wait and let the money earn ${pct(marr, 0)}?`;
  if (deal.risky) {
    const [s, w] = deal.projects[0].scenarios;
    return [
      `Nobody knows which future will happen: ${s.name.toLowerCase()} (${pct(s.p, 0)} chance) or ${w.name.toLowerCase()} (${pct(w.p, 0)} chance). `,
      h("b", {}, "Fund at most one"),
      ` of these with your ${budget}, or wait.`,
    ];
  }
  if (deal.horizon) {
    return [
      `Both machines do the same job, and the plant needs that job for ${deal.horizon} years. `,
      h("b", {}, "Fund at most one"),
      `. A machine with a shorter life is bought again each time it wears out. Budget today: ${budget}.`,
    ];
  }
  if (deal.mode === "exclusive") return ["These projects solve the same problem, so they are mutually exclusive: ", h("b", {}, "fund at most one"), `. Budget: ${budget}.`];
  return ["These projects are independent: ", h("b", {}, "fund any mix that fits the budget"), ` of ${budget}. Money you don't spend keeps earning ${pct(marr, 0)}.`];
}

function describeChoice(deal, choice) {
  if (!choice.length) return "You are waiting: nothing funded.";
  const names = choice.map((i) => deal.projects[i].name).join(" + ");
  return `Funding ${names} for ${usd(selectionCost(deal, choice))} of your ${usd(deal.budget)}.`;
}

function facts(p, deal) {
  const save = p.scenarios ? p.scenarios.map((s) => `${usd(s.annual)} if ${s.name.toLowerCase()}`).join(", ") : usd(p.annual);
  const rows = [
    ["First cost", usd(p.cost)],
    ["Saves each year", save],
    ["Salvage value", p.salvage ? `${usd(p.salvage)} in year ${p.life}` : "$0"],
    ["Life", deal.horizon && deal.horizon !== p.life ? `${p.life} years (bought ${deal.horizon / p.life} times)` : `${p.life} years`],
  ];
  return h("dl", { class: "iw-facts" }, rows.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v))));
}

// ---------------------------------------------------------------- diagrams

/** One dollar scale for every diagram in a deal, so arrows can be compared between cards. */
function flowScale(deal) {
  const up = Math.max(...deal.projects.map((p) => (p.scenarios ? Math.max(...p.scenarios.map((s) => s.annual)) : p.annual) + p.salvage));
  const down = Math.max(...deal.projects.map((p) => p.cost));
  const scale = Math.min(60 / up, 56 / down);
  return { scale, up: Math.max(7, up * scale), down: Math.max(7, down * scale) };
}

function flowDiagram(p, deal, { scale, up, down }) {
  const W = 300;
  const base = 34 + up;
  const H = base + down + 22;
  const left = 24;
  const right = 14;
  const n = deal.horizon || p.life;
  const x = (t) => left + (t * (W - left - right)) / n;
  const len = (dollars) => Math.max(7, dollars * scale);
  const els = [];
  const arrow = (cx, from, to, cls) => {
    const dir = to < from ? -1 : 1;
    els.push(svg("line", { x1: cx, x2: cx, y1: from, y2: to - dir * 4, class: `iw-flow ${cls}` }));
    els.push(svg("path", { d: `M${cx - 3.5},${to - dir * 5} L${cx + 3.5},${to - dir * 5} L${cx},${to} z`, class: `iw-flow-head ${cls}` }));
  };
  els.push(svg("line", { x1: left - 6, x2: W - right + 6, y1: base, y2: base, class: "iw-flow-axis" }));

  const low = p.scenarios ? Math.min(...p.scenarios.map((s) => s.annual)) : p.annual;
  const high = p.scenarios ? Math.max(...p.scenarios.map((s) => s.annual)) : p.annual;
  const buyYears = [];
  for (let t0 = 0; t0 < n; t0 += p.life) buyYears.push(t0);

  for (let t = 0; t <= n; t++) {
    const buying = buyYears.includes(t);
    els.push(svg("line", { x1: x(t), x2: x(t), y1: base - 2, y2: base + 2, class: "iw-flow-axis" }));
    els.push(svg("text", { x: x(t), y: base + 12, class: "iw-flow-year", "text-anchor": "middle" }, t));
    if (buying) arrow(x(t) - 6, base, base + len(p.cost), "is-cost");
    if (t === 0) continue;
    arrow(x(t), base, base - len(low), "is-save");
    if (high > low) {
      els.push(svg("line", { x1: x(t), x2: x(t), y1: base - len(low), y2: base - len(high), class: "iw-flow is-maybe" }));
      els.push(svg("path", { d: `M${x(t) - 3.5},${base - len(high) + 5} L${x(t)},${base - len(high)} L${x(t) + 3.5},${base - len(high) + 5}`, class: "iw-flow is-maybe-head" }));
    }
    if (p.salvage && t % p.life === 0) {
      const y0 = base - len(high);
      els.push(svg("line", { x1: x(t), x2: x(t), y1: y0, y2: y0 - len(p.salvage), class: "iw-flow is-salvage" }));
      els.push(svg("circle", { cx: x(t), cy: y0 - len(p.salvage), r: 3, class: "iw-flow-dot" }));
    }
  }
  els.push(svg("text", { x: left - 10, y: H - 5, class: "iw-flow-label" }, `−${usd(p.cost)} today${buyYears.length > 1 ? `, and again in year ${buyYears.slice(1).join(" and ")}` : ""}`));
  els.push(svg("text", { x: W - right, y: 11, class: "iw-flow-label", "text-anchor": "end" }, high > low ? `+${usd(low)} to +${usd(high)} a year` : `+${usd(low)} a year`));
  if (p.salvage) els.push(svg("text", { x: W - right, y: 23, class: "iw-flow-label is-muted", "text-anchor": "end" }, `+${usd(p.salvage)} salvage (dashed)`));
  els.push(svg("text", { x: W - right + 6, y: base + 24, class: "iw-flow-year", "text-anchor": "end" }, "end of year"));

  const savings = p.scenarios ? p.scenarios.map((s) => `${usd(s.annual)} if ${s.name.toLowerCase()}`).join(" or ") : usd(p.annual);
  const repeat = buyYears.length > 1 ? ` Bought again in year ${buyYears.slice(1).join(" and year ")}.` : "";
  const label = `Cash flow diagram for ${p.name}: pay ${usd(p.cost)} today, then receive ${savings} at the end of each of ${p.life} years${p.salvage ? `, plus ${usd(p.salvage)} salvage in year ${p.life}` : ""}.${repeat}`;
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "iw-flow-svg", role: "img", "aria-label": label }, els);
}

function discountTable(marr, maxYear) {
  const rows = [];
  for (let t = 1; t <= maxYear; t++) rows.push(h("tr", {}, h("th", { scope: "row" }, t), h("td", {}, `$${fmt(pvFactor(marr, t), 3)}`), h("td", {}, `$${fmt(annuityFactor(marr, t), 3)}`)));
  return h(
    "details",
    { class: "iw-factors" },
    h("summary", {}, `Free help: discount table at ${pct(marr, 0)}`),
    h(
      "p",
      {},
      `What money in a later year is worth today at ${pct(marr, 0)}. Estimate an NPV as: − first cost + yearly savings × (third column, at the project's life) + salvage × (second column, at the last year).`,
    ),
    h(
      "div",
      { class: "g-table-wrap" },
      h(
        "table",
        { class: "g-table iw-factor-table" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Year n"), h("th", { scope: "col" }, "$1 in year n is worth today"), h("th", { scope: "col" }, "$1 every year for n years is worth today"))),
        h("tbody", {}, rows),
      ),
    ),
  );
}

// ---------------------------------------------------------------- results

function pickLabel(deal, picks) {
  if (!picks.length) return "Wait";
  if (deal.projects.length === 1) return "Invest";
  return picks.map((i) => deal.projects[i].id).join(" + ");
}

function showResults(ctx, round, choices, hoursUsed) {
  const { deals, marr } = round;
  const score = scoreRound(round, choices);
  const { totals, stars } = score;
  const info = deals.map((deal) => deal.projects.map((p) => analyze(p, deal, marr)));
  const valueWord = round.kind === "risky" ? "expected NPV" : round.kind === "lives" ? "NPV over the common period" : "NPV";

  const headline =
    stars === 3
      ? "Every dollar in the right place"
      : stars === 2
        ? "Close to the best value"
        : stars === 1
          ? "Some value added, more left on the table"
          : totals.you < -0.5
            ? "Waiting would have been better"
            : "No value added this time";

  const cell = (deal, sel) => h("span", {}, h("b", {}, pickLabel(deal, sel.picks)), h("br"), signed(sel.value));
  const rows = deals.map((deal, k) => ({
    label: deal.projects.length === 1 ? `${k + 1}. ${deal.projects[0].name}` : `Decision ${k + 1}`,
    values: [cell(deal, score.deals[k].you), cell(deal, score.deals[k].best), cell(deal, score.deals[k].payback)],
  }));
  rows.push({ label: `Total value added (${valueWord})`, values: [totals.you, totals.best, totals.payback].map((v) => h("b", {}, signed(v))) });

  ctx.finish({
    outcome: stars === 3 ? "win" : stars === 0 ? "miss" : "ok",
    stars,
    headline,
    summary: `Your choices added <b>${signed(totals.you)}</b> of value (${valueWord} at a MARR of ${pct(marr, 0)}). The best choices add ${signed(totals.best)}, and payback-only thinking adds ${signed(
      totals.payback,
    )}. You used ${hoursUsed} of ${round.hours} analyst hours.`,
    comparison: {
      caption: `You compared with the best ${valueWord} and with a manager who only looks at payback (nothing slower than ${PAYBACK_CUTOFF} years)`,
      columns: ["You", "Best NPV", "Payback only"],
      rows,
    },
    figure: h(
      "div",
      { class: "g-card iw-chart-card" },
      deals.map((deal, k) => valueChart(deal, k, info[k], score.deals[k], deals.length, valueWord)),
      h("p", { class: "iw-chart-note" }, "Solid bars to the right add value. Striped bars to the left lose value compared with waiting."),
    ),
    debrief: debrief(round, score, info),
  });
}

/** Horizontal bars of each project's value, tagged with who picked it. */
function valueChart(deal, k, info, result, count, valueWord) {
  const values = info.map((a) => a.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const zero = (-lo / span) * 100;
  const tag = (i, key, text) => (result[key].picks.includes(i) ? h("span", { class: `iw-tag is-${key}` }, text) : null);
  return h(
    "section",
    { class: "iw-chart" },
    count > 1 ? h("h3", { class: "iw-chart-title" }, `Decision ${k + 1}`) : null,
    h(
      "ul",
      { class: "iw-bars", "aria-label": `${valueWord} of each project${count > 1 ? ` in decision ${k + 1}` : ""}` },
      deal.projects.map((p, i) => {
        const v = values[i];
        const width = (Math.abs(v) / span) * 100;
        return h(
          "li",
          { class: "iw-bar-row" },
          h(
            "div",
            { class: "iw-bar-head" },
            h("span", { class: "iw-bar-name" }, deal.projects.length > 1 ? h("span", { class: "iw-id" }, p.id) : null, p.name),
            tag(i, "you", "You ✔"),
            tag(i, "best", "Best ★"),
            tag(i, "payback", "Payback ◷"),
          ),
          h(
            "div",
            { class: "iw-bar-line" },
            h(
              "div",
              { class: "iw-bar-track" },
              h("span", { class: "iw-bar-zero", style: `left:${zero}%` }),
              h("span", { class: `iw-bar ${v < 0 ? "is-neg" : "is-pos"}`, style: `left:${v < 0 ? zero - width : zero}%;width:${Math.max(width, 0.8)}%` }),
            ),
            h("span", { class: "iw-bar-value" }, signed(v)),
          ),
          h("div", { class: "iw-bar-sub" }, `payback ${Number.isFinite(info[i].payback) ? `${fmt(info[i].payback, 1)} yr` : "never"} · IRR ${info[i].irr == null ? "negative" : pct(info[i].irr, 1)}`),
        );
      }),
    ),
  );
}

function debrief(round, score, info) {
  const { deals, marr } = round;
  const m = pct(marr, 0);
  const all = deals.flatMap((deal, k) => deal.projects.map((p, i) => ({ deal, k, i, p, a: info[k][i] })));
  const where = (k) => (deals.length > 1 ? ` (decision ${k + 1})` : "");
  const out = [];

  // 1. Time value of money, worked on the most valuable project the best plan funds.
  const funded = all.filter((x) => score.deals[x.k].best.picks.includes(x.i));
  const ex = (funded.length ? funded : all).reduce((a, b) => (b.a.npv > a.a.npv ? b : a));
  const annual = Math.round(ex.p.annual);
  const pa = annuityFactor(marr, ex.p.life);
  const pf = pvFactor(marr, ex.p.life);
  out.push({
    title: "Time value of money",
    body: h(
      "div",
      {},
      h(
        "p",
        {},
        `A dollar you get later is worth less than a dollar today, because today's dollar could be earning ${m}. At ${m}, $1 at the end of year ${ex.p.life} is worth $${fmt(pf, 3)} today, and $1 at the end of each of ${ex.p.life} years is worth $${fmt(pa, 3)} today, not $${ex.p.life}.`,
      ),
      h(
        "p",
        { class: "g-formula" },
        `NPV of ${ex.p.name} = −${usd(ex.p.cost)} + ${usd(annual)} × ${fmt(pa, 3)}${ex.p.salvage ? ` + ${usd(ex.p.salvage)} × ${fmt(pf, 3)}` : ""} ≈ ${signed(ex.a.npv)}`,
      ),
      h("p", {}, `Net present value (NPV) adds up every cash flow after bringing it back to today. ${ex.p.scenarios ? "Here the yearly savings are the expected (average) savings. " : ""}A positive NPV means the project beats leaving the money alone.`),
    ),
  });

  // 2. NPV vs payback, with this round's disagreements.
  const clashes = [];
  deals.forEach((deal, k) => {
    const best = score.deals[k].best.picks;
    const pb = score.deals[k].payback.picks;
    const describe = (i) => {
      const a = info[k][i];
      return `${deal.projects[i].name} (payback ${Number.isFinite(a.payback) ? `${fmt(a.payback, 1)} years` : "never"}, ${signed(a.value)})`;
    };
    const wrongYes = pb.filter((i) => !best.includes(i));
    const wrongNo = best.filter((i) => !pb.includes(i));
    if (wrongYes.length) clashes.push(`funded ${wrongYes.map(describe).join(" and ")}${where(k)}`);
    if (wrongNo.length) clashes.push(`passed over ${wrongNo.map(describe).join(" and ")}${where(k)}`);
  });
  out.push({
    title: "NPV vs. payback",
    body: `<p>The <b>payback period</b> asks one question: how soon do I get my money back? It ignores every dollar that arrives after that date, and it counts a dollar in year 3 the same as a dollar today.</p><p>${
      clashes.length ? `This round, payback-only thinking ${clashes.join("; and it ")}.` : "This round, payback-only thinking happened to agree with NPV."
    } In total it added ${signed(score.totals.payback)}; choosing by NPV adds ${signed(score.totals.best)}.</p><p>Payback is still a useful warning about risk and cash, but NPV tells you how much value a project creates.</p>`,
  });

  // 3. MARR (and IRR where the tool exists).
  const irrClash = round.tools.includes("irr")
    ? deals
        .map((deal, k) => {
          if (deal.mode !== "exclusive" || deal.horizon || deal.risky) return null;
          const top = info[k].reduce((a, b, i) => (b.irr != null && b.irr > (info[k][a].irr ?? -1) ? i : a), 0);
          const best = score.deals[k].best.picks[0];
          if (best == null || top === best) return null;
          return `In decision ${k + 1}, ${deal.projects[top].name} has the highest IRR (${pct(info[k][top].irr, 1)}) but an NPV of only ${signed(info[k][top].value)}, while ${deal.projects[best].name} earns ${pct(info[k][best].irr, 1)} on a bigger investment for an NPV of ${signed(info[k][best].value)}.`;
        })
        .find(Boolean)
    : null;
  out.push({
    title: "MARR: the bar a project must clear",
    body: `<p>The <b>minimum attractive rate of return</b> (MARR) is what your money earns if you wait. This round it was ${m}. That is why waiting is worth exactly $0 of NPV, and why a project with a negative NPV is worse than doing nothing, even if it pays its cost back.</p>${
      round.tools.includes("irr")
        ? `<p>The <b>internal rate of return</b> (IRR) is the interest rate at which a project's NPV would be exactly $0. An IRR above the MARR means a positive NPV. But the highest IRR is not always the best choice. ${
            irrClash || "A small project can earn a high percentage on very few dollars."
          } You keep dollars of NPV, not percentages.</p>`
        : ""
    }`,
  });

  // 4. Unequal lives.
  if (round.kind === "lives") {
    const k = Math.max(0, deals.findIndex((d) => d.trap));
    const deal = deals[k];
    const short = deal.projects[deal.short];
    const long = deal.projects[1 - deal.short];
    const s1 = info[k][deal.short].npv;
    const times = deal.horizon / short.life;
    const parts = [];
    for (let t = short.life; t < deal.horizon; t += short.life) parts.push(`${usd(s1)} × ${fmt(pvFactor(marr, t), 3)}`);
    const naive = oneLifeSelection(deal, marr);
    out.push({
      title: "Unequal lives",
      body: h(
        "div",
        {},
        h(
          "p",
          {},
          `In decision ${k + 1}, ${short.name} lasts ${short.life} years and ${long.name} lasts ${long.life}. One life of each is not a fair comparison, because the plant needs the job done for ${deal.horizon} years either way. So compare them over a common period: buy ${short.name} ${times} times.`,
        ),
        h("p", { class: "g-formula" }, `${short.name}: ${usd(s1)} + ${parts.join(" + ")} ≈ ${signed(info[k][deal.short].value)}`),
        h("p", { class: "g-formula" }, `${long.name}: ${signed(info[k][1 - deal.short].value)} (one ${long.life}-year life)`),
        h(
          "p",
          {},
          `Each repeat purchase has the same NPV as the first, but it starts later, so it is discounted back to today. Comparing one-life NPVs alone (${signed(s1)} vs ${signed(info[k][1 - deal.short].npv)}) would have picked ${
            naive.length ? deal.projects[naive[0]].name : "neither"
          }; over ${deal.horizon} years the better choice is ${deal.projects[score.deals[k].best.picks[0]].name}.`,
        ),
      ),
    });
  }

  // 5. Risk.
  if (round.kind === "risky") {
    const lines = deals.map((deal, k) => {
      const happened = deal.projects[0].scenarios[deal.realized].name;
      const real = (picks) => (picks.length ? signed(info[k][picks[0]].scenarios[deal.realized].npv) : "$0");
      return h(
        "li",
        {},
        `Decision ${k + 1} outcome: ${happened}. Your choice (${pickLabel(deal, score.deals[k].you.picks)}) ended up worth ${real(score.deals[k].you.picks)}; the best expected-value choice (${pickLabel(
          deal,
          score.deals[k].best.picks,
        )}) ended up worth ${real(score.deals[k].best.picks)}.`,
      );
    });
    const k = 0;
    const b = score.deals[k].best.picks[0];
    const sc = info[k][b].scenarios;
    out.push({
      title: "Deciding under risk: expected NPV",
      body: h(
        "div",
        {},
        h("p", {}, "When the future is uncertain, weight each scenario's NPV by its probability. The result is the expected NPV: what you would average if you could make the same bet many times."),
        h("p", { class: "g-formula" }, `${deals[k].projects[b].name}: ${fmt(sc[0].p, 1)} × ${signed(sc[0].npv)} + ${fmt(sc[1].p, 1)} × ${signed(sc[1].npv)} ≈ ${signed(info[k][b].value)}`),
        h("p", {}, "What actually happened in this round:"),
        h("ul", {}, lines),
        h("p", {}, "A good decision can still have a bad outcome, and a lucky outcome doesn't make a decision good. The game scores the decision, not the luck. Real companies also ask how much loss they can survive, which this game ignores."),
      ),
    });
  }
  return out;
}
