// Pay for Info?: decide what a forecast is worth, then make the decision.
import { createGame } from "../shared/shell.js";
import { h, svg, replace, fmt, pct } from "../shared/dom.js";
import {
  ASSUMPTIONS,
  LEVELS,
  PLAYS,
  emvs,
  bestBlind,
  mostLikelyAction,
  valueWithPerfectInfo,
  evpi,
  joint,
  posteriors,
  jointCounts,
  bestPlan,
  valueWithForecast,
  buys,
  simulate,
  scoreRound,
  generateRound,
} from "./logic.js";

/** Money in thousands of dollars: 120 -> "$120k", -40 -> "−$40k", 28.8 -> "$28.8k". */
const k = (x) => {
  const r = Math.round(x * 10) / 10;
  if (r === 0) return "$0";
  return `${r < 0 ? "−" : ""}$${fmt(Math.abs(r), Number.isInteger(r) ? 0 : 1)}k`;
};
const paren = (x) => (x < 0 ? `(${k(x)})` : k(x));
const p0 = (x) => pct(x, 0);
const N_PLAYS = PLAYS.toLocaleString("en-US");
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

createGame({
  slug: "pay-for-info",
  title: "Pay for Info?",
  tagline: "A forecast is for sale. What is it really worth to you?",
  objective:
    "choose the action with the highest expected monetary value (EMV), work out what a forecast is worth before you buy it, and explain why perfect information sets the ceiling.",
  minutes: "10-15",
  chapter: { href: "../../chapters/week-10.html", label: "Week 10 · Modeling, Optimization, and Simulation" },
  howToPlay: [
    "You face a business decision with an uncertain result. The <b>payoff table</b> shows what each action earns for each level of demand, and how likely each level is. Amounts are in thousands of dollars ($k).",
    "From level 2, a <b>forecast</b> is for sale. First type the <b>most you would pay</b> for it. Then the seller's price is revealed: if it is at or below your number, you buy at the seller's price.",
    "Then make your <b>plan</b>. With a forecast, choose an action for each thing it might say. Without one, choose one action.",
    `The game then replays your decision ${N_PLAYS} times, so you can see the long-run average and compare it with the best possible policy.`,
  ],
  assumptions: ASSUMPTIONS,
  levels: LEVELS,
  start,
});

function start(ctx) {
  const model = generateRound(ctx.rng, ctx.level);
  const f = model.forecast;
  const state = {
    bid: 0,
    bidLocked: !f, // no forecast: straight to the plan
    bought: false,
    action: null,
    plan: f ? f.reports.map(() => null) : null,
  };

  ctx.setStatus(h("p", { class: "pi-story" }, model.story));

  function render(focusKey) {
    replace(
      ctx.stage,
      section("1", "The decision", payoffTable(model), h("p", { class: "pi-note" }, "Each cell is the profit, in thousands of dollars, if you take that action and demand turns out that way.")),
      f ? section("2", `For sale: a ${f.source}`, forecastInfo(model)) : null,
      f ? section("3", "Your highest price", bidBox()) : null,
      state.bidLocked ? section(f ? "4" : "2", "Your plan", planBox()) : null,
    );
    if (focusKey) ctx.stage.querySelector(`[data-fk="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  function bidBox() {
    if (state.bidLocked) {
      return h(
        "div",
        { class: `pi-outcome ${state.bought ? "is-bought" : "is-passed"}`, role: "status" },
        h("p", {}, `The seller asks `, h("b", {}, k(model.price)), `. Your highest price was ${k(state.bid)}.`),
        h(
          "p",
          {},
          h("b", {}, state.bought ? `✔ You bought the ${f.source} for ${k(model.price)}.` : `✖ Too expensive for you: you decide without the ${f.source}.`),
        ),
      );
    }
    // Updated in place (no re-render), so a click on "Lock in" right after typing is never lost.
    const clamp = (v) => Math.max(0, Math.min(999, Math.round(Number(v) || 0)));
    const lockBtn = h("button", { type: "button", class: "g-btn g-btn-primary", dataset: { fk: "bid-lock" }, onclick: lockBid }, `Lock in ${k(state.bid)}`);
    const input = h("input", {
      type: "number",
      min: "0",
      max: "999",
      step: "1",
      inputmode: "numeric",
      value: String(state.bid),
      "aria-label": "The most you would pay, in thousands of dollars",
      dataset: { fk: "bid" },
      oninput: () => set(input.value, false),
      onchange: () => set(input.value, true),
    });
    function set(v, rewrite) {
      state.bid = clamp(v);
      if (rewrite) input.value = String(state.bid);
      lockBtn.textContent = `Lock in ${k(state.bid)}`;
    }
    return h(
      "div",
      { class: "pi-bid" },
      h(
        "p",
        {},
        `The seller's price is hidden. Type the most you would pay for the ${f.source}. If the seller's price is at or below your number, you buy it at the seller's price. If it is higher, you go without.`,
      ),
      h(
        "div",
        { class: "pi-bid-row" },
        h("button", { type: "button", class: "g-btn pi-step", "aria-label": "Lower by $1k", onclick: () => set(state.bid - 1, true) }, "−"),
        h("label", { class: "pi-bid-field" }, h("span", { class: "pi-bid-unit" }, "$"), input, h("span", { class: "pi-bid-unit" }, "k")),
        h("button", { type: "button", class: "g-btn pi-step", "aria-label": "Raise by $1k", onclick: () => set(state.bid + 1, true) }, "+"),
        lockBtn,
      ),
      h("p", { class: "pi-note" }, "Tip: a forecast is worth what it adds to your expected profit. $0 means you would not buy it at any price."),
    );
  }

  function lockBid() {
    const input = ctx.stage.querySelector('[data-fk="bid"]');
    if (input) state.bid = Math.max(0, Math.min(999, Math.round(Number(input.value) || 0)));
    state.bidLocked = true;
    state.bought = buys(state.bid, model.price);
    ctx.announce(
      state.bought ? `The seller asks ${k(model.price)}. You bought the ${f.source}. Now choose an action for each report.` : `The seller asks ${k(model.price)}, more than your highest price. Choose your action without the ${f.source}.`,
    );
    render();
    ctx.stage.querySelector(".pi-plan input")?.focus({ preventScroll: true });
  }

  function actionRadios(name, selected, onPick, fkPrefix) {
    return h(
      "div",
      { class: "pi-options" },
      model.actions.map((a, i) =>
        h(
          "label",
          { class: `pi-option${selected === i ? " is-on" : ""}` },
          h("input", { type: "radio", name, checked: selected === i, dataset: { fk: `${fkPrefix}-${i}` }, onchange: () => onPick(i, `${fkPrefix}-${i}`) }),
          a,
        ),
      ),
    );
  }

  function planBox() {
    let body;
    let ready;
    if (state.bought) {
      body = f.reports.map((r, ri) =>
        h(
          "fieldset",
          { class: "pi-fieldset" },
          h("legend", {}, `If the ${f.source} ${r}:`),
          actionRadios(`plan-${ri}`, state.plan[ri], (i, fk) => {
            state.plan[ri] = i;
            render(fk);
          }, `plan-${ri}`),
        ),
      );
      ready = state.plan.every((a) => a !== null);
    } else {
      body = h(
        "fieldset",
        { class: "pi-fieldset" },
        h("legend", {}, f ? `Without the ${f.source}, which action do you take?` : "Which action do you take?"),
        actionRadios("blind", state.action, (i, fk) => {
          state.action = i;
          render(fk);
        }, "blind"),
      );
      ready = state.action !== null;
    }
    return h(
      "div",
      { class: "pi-plan" },
      body,
      h(
        "div",
        { class: "g-actions" },
        h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", disabled: !ready, dataset: { fk: "run" }, onclick: finish }, `Decide, then replay it ${N_PLAYS} times`),
      ),
    );
  }

  function finish() {
    const decision = { bid: f ? state.bid : null, action: state.bought ? bestBlind(model).action : state.action, plan: state.bought ? state.plan.slice() : null };
    showResults(ctx, model, decision);
  }

  render();
}

function section(num, title, ...body) {
  return h("section", { class: "g-card pi-section" }, h("h2", { class: "pi-h2" }, h("span", { class: "pi-num" }, num), title), body);
}

function payoffTable(model, mark) {
  return h(
    "div",
    { class: "g-table-wrap" },
    h(
      "table",
      { class: "g-table pi-payoff" },
      h("caption", { class: "g-sr-only" }, "Payoff table: profit in thousands of dollars for each action and demand level"),
      h(
        "thead",
        {},
        h("tr", {}, h("th", { scope: "col" }, "Action"), model.states.map((s, i) => h("th", { scope: "col" }, s, h("br"), h("span", { class: "pi-prob" }, `${p0(model.prior[i])} chance`))), mark ? h("th", { scope: "col" }, "EMV") : null),
      ),
      h(
        "tbody",
        {},
        model.actions.map((a, i) =>
          h(
            "tr",
            { class: mark && mark.best === i ? "is-best" : null },
            h("th", { scope: "row" }, a, mark && mark.best === i ? h("span", { class: "pi-tag" }, "★ best") : null),
            model.payoff[i].map((v) => h("td", { class: v < 0 ? "is-loss" : null }, k(v))),
            mark ? h("td", {}, h("b", {}, k(mark.emv[i]))) : null,
          ),
        ),
      ),
    ),
  );
}

function forecastInfo(model) {
  const f = model.forecast;
  const L = f.likelihood;
  const counts = jointCounts(model);
  const perfect = L[0][0] === 1 && L[1][1] === 1;
  const lines = perfect
    ? [h("p", {}, `This ${f.source} always reports the true demand: it ${f.reports[0]} exactly when demand will be strong, and ${f.reports[1]} exactly when demand will be weak.`)]
    : [
        h(
          "ul",
          { class: "pi-acc" },
          model.states.map((s, si) =>
            h("li", {}, `When demand will be ${lower(s).replace(" demand", "")}, it ${f.reports[0]} `, h("b", {}, p0(L[si][0])), ` of the time and ${f.reports[1]} `, h("b", {}, p0(L[si][1])), " of the time."),
          ),
        ),
      ];
  return [
    ...lines,
    h(
      "div",
      { class: "g-table-wrap" },
      h(
        "table",
        { class: "g-table pi-counts" },
        h("caption", {}, "Picture 100 decisions like this one. How often does each thing happen?"),
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Demand turns out"), f.reports.map((r) => h("th", { scope: "col" }, `It ${r}`)), h("th", { scope: "col" }, "Total"))),
        h(
          "tbody",
          {},
          model.states.map((s, si) => h("tr", {}, h("th", { scope: "row" }, s), counts[si].map((c) => h("td", {}, c)), h("td", {}, counts[si][0] + counts[si][1]))),
          h("tr", { class: "pi-total" }, h("th", { scope: "row" }, "Total"), f.reports.map((_, r) => h("td", {}, counts[0][r] + counts[1][r])), h("td", {}, 100)),
        ),
      ),
    ),
  ];
}

// ---------------------------------------------------------------- results

function policyText(model, policy) {
  if (!policy.buy) return model.actions[policy.action];
  return model.forecast.reports.map((r, i) => `${r.replace("says ", "")} → ${model.actions[policy.plan[i]]}`).join("; ");
}

function showResults(ctx, model, decision) {
  const f = model.forecast;
  const score = scoreRound(model, decision);
  const { you, best, value, worth, stars } = score;
  const e = emvs(model);
  const likely = mostLikelyAction(model);
  const third = f ? { policy: score.blind, value: value.blind, name: "No forecast" } : { policy: { buy: false, action: likely.action, plan: null }, value: e[likely.action], name: "Most likely state" };
  const sim = simulate(model, [you, best, third.policy], ctx.rng.fork("replay"));
  const sameAsBest = Math.abs(value.you - value.best) < 1e-9;

  let headline;
  if (!f) headline = stars === 3 ? "Best bet: the highest expected value" : `You gave up ${k(score.regret)} of expected value`;
  else if (stars === 3) headline = "Best policy, and you priced the forecast right";
  else if (sameAsBest) headline = "Right decision, but your price was off";
  else headline = `You gave up ${k(score.regret)} of expected value`;

  let summary;
  if (!f) {
    summary = `You chose <b>${model.actions[you.action]}</b>, with an expected value of <b>${k(value.you)}</b>. The best bet is ${model.actions[best.action]} (${k(value.best)}). Planning only for the most likely state, ${lower(
      model.states[likely.state],
    )}, picks ${model.actions[likely.action]} (${k(e[likely.action])}).`;
  } else {
    const verdict = worth > model.price ? `so it was <b>worth buying</b> (it adds ${k(worth - model.price)} after its price)` : worth > 0 ? `so it was <b>not worth buying</b>` : `so it was <b>not worth buying at any price</b>`;
    summary = `The ${f.source} was worth <b>${k(worth)}</b> and the seller asked <b>${k(model.price)}</b>, ${verdict}. Your highest price was ${k(decision.bid)}, so you ${
      you.buy ? "bought it" : "went without"
    }. Your policy is worth ${k(value.you)} per decision on average; the best policy is worth ${k(value.best)}.`;
  }

  const cols = [
    { policy: you, value: value.you, sim: sim.results[0] },
    { policy: best, value: value.best, sim: sim.results[1] },
    { policy: third.policy, value: third.value, sim: sim.results[2] },
  ];
  const rows = [];
  if (f) rows.push({ label: "Buy the forecast?", values: cols.map((c) => (c.policy.buy ? `Yes, ${k(model.price)}` : "No")) });
  rows.push({ label: f ? "Plan" : "Action", values: cols.map((c) => policyText(model, c.policy)) });
  rows.push({ label: "Expected value", values: cols.map((c) => h("b", {}, k(c.value))) });
  rows.push({ label: `Average of ${N_PLAYS} replays`, values: cols.map((c) => k(c.sim.mean)) });

  ctx.finish({
    outcome: stars === 3 ? "win" : stars === 0 ? "miss" : "ok",
    stars,
    headline,
    summary,
    comparison: {
      caption: f ? "Your policy compared with the best policy and with deciding without the forecast (profit after paying for the forecast)" : "Your action compared with the best expected value and with planning for the most likely state",
      columns: ["You", f ? "Best policy" : "Best EMV", third.name],
      rows,
    },
    figure: h(
      "div",
      { class: "g-card pi-chart-card" },
      h("h2", { class: "pi-chart-title" }, `The same decision, replayed ${N_PLAYS} times: average profit so far`),
      runningChart(cols, ["You", f ? "Best policy" : "Best EMV", third.name], chartWidth()),
      h("p", { class: "pi-note" }, "One play can land anywhere. Over many plays the average settles at the expected value (the dotted lines). That is why the expected value is the right guide for a decision you face again and again."),
      firstPlays(model, you, sim),
    ),
    debrief: debrief(model, score, decision),
  });
}

function chartWidth() {
  const el = document.querySelector(".g-screen");
  const w = el && el.clientWidth ? el.clientWidth - 24 : 700;
  return Math.round(Math.min(720, Math.max(300, w)));
}

/** Running average of each policy over the replays, with its expected value as a dotted reference line. */
function runningChart(cols, names, W) {
  const H = 250;
  const left = 50;
  const right = 104;
  const top = 12;
  const bottom = 36;
  const n = cols[0].sim.running.length;
  // Policies that are identical share one line, labeled with every name.
  const shown = [];
  cols.forEach((c, i) => {
    const key = JSON.stringify(c.policy);
    const twin = shown.find((g) => g.key === key);
    if (twin) twin.names.push(`= ${names[i]}`);
    else shown.push({ ...c, key, names: [names[i]], cls: `is-s${i}` });
  });
  const skip = Math.min(n - 1, Math.round(n / 40)); // the first few plays swing wildly; don't let them set the scale
  const settled = shown.flatMap((c) => c.sim.running.slice(skip)).concat(shown.map((c) => c.value));
  let lo = Math.min(...settled);
  let hi = Math.max(...settled);
  const padY = Math.max(4, (hi - lo) * 0.15);
  lo -= padY;
  hi += padY;
  const x = (i) => left + (i / (n - 1)) * (W - left - right);
  const y = (v) => top + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - top - bottom);
  const els = [];
  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    els.push(svg("line", { x1: left, x2: W - right, y1: y(v), y2: y(v), class: "pi-grid" }));
    els.push(svg("text", { x: left - 6, y: y(v) + 4, class: "pi-axis", "text-anchor": "end" }, k(v)));
  }
  [1, n / 4, n / 2, (3 * n) / 4, n].forEach((t) => els.push(svg("text", { x: x(t - 1), y: H - bottom + 15, class: "pi-axis", "text-anchor": "middle" }, Math.round(t).toLocaleString("en-US"))));
  els.push(svg("text", { x: (left + W - right) / 2, y: H - 5, class: "pi-axis", "text-anchor": "middle" }, "Number of replays"));
  shown.forEach((c) => {
    els.push(svg("line", { x1: left, x2: W - right, y1: y(c.value), y2: y(c.value), class: `pi-ref ${c.cls}` }));
    const d = c.sim.running.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    els.push(svg("path", { d, class: `pi-run ${c.cls}` }));
  });
  // Direct labels at the right end, nudged apart.
  let next = -Infinity;
  shown
    .map((c) => ({ c, at: y(c.sim.running[n - 1]) }))
    .sort((a, b) => a.at - b.at)
    .forEach(({ c, at }) => {
      let ly = Math.max(at + 4, next);
      c.names.forEach((name) => {
        els.push(svg("text", { x: W - right + 6, y: ly, class: `pi-label ${c.cls}` }, name));
        ly += 13;
      });
      els.push(svg("text", { x: W - right + 6, y: ly - 1, class: "pi-axis" }, `avg ${k(c.sim.mean)}`));
      next = ly + 15;
    });
  const label = `Average profit over ${n} replays. ${shown.map((c) => `${c.names.join(" ")}: average ${k(c.sim.mean)}, expected ${k(c.value)}`).join(". ")}.`;
  return svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "pi-chart", role: "img", "aria-label": label }, els);
}

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const fr = raw / pow;
  return (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 5 ? 5 : 10) * pow;
}

function firstPlays(model, you, sim) {
  const f = model.forecast;
  const rows = sim.plays.slice(0, 6).map((play, i) => {
    const action = you.buy ? you.plan[play.report] : you.action;
    const net = sim.results[0].payoffs[i];
    return h(
      "tr",
      {},
      h("th", { scope: "row" }, i + 1),
      f && you.buy ? h("td", {}, f.reports[play.report].replace("says ", "")) : null,
      h("td", {}, model.actions[action]),
      h("td", {}, model.states[play.state]),
      h("td", { class: net < 0 ? "is-loss" : null }, k(net)),
    );
  });
  return h(
    "div",
    { class: "g-table-wrap" },
    h(
      "table",
      { class: "g-table pi-plays" },
      h("caption", {}, `Your first 6 replays${you.buy ? ` (profit after the ${k(model.price)} forecast)` : ""}`),
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "#"), f && you.buy ? h("th", { scope: "col" }, "Forecast said") : null, h("th", { scope: "col" }, "You did"), h("th", { scope: "col" }, "Demand was"), h("th", { scope: "col" }, "Profit"))),
      h("tbody", {}, rows),
    ),
  );
}

function debrief(model, score, decision) {
  const f = model.forecast;
  const e = emvs(model);
  const blind = bestBlind(model);
  const out = [];
  const terms = (row, probs) => row.map((v, s) => `${fmt(probs[s], 2).replace(/0$/, "")} × ${paren(v)}`).join(" + ");

  out.push({
    title: "Expected monetary value (EMV)",
    body: h(
      "div",
      {},
      h("p", {}, "Multiply each payoff by its probability and add them up. That is the action's expected monetary value: its average profit if you could face this decision many times."),
      model.actions.map((a, i) => h("p", { class: "g-formula" }, `${a}: ${terms(model.payoff[i], model.prior)} = ${k(e[i])}${i === blind.action ? "  ★ best" : ""}`)),
      !f
        ? h(
            "p",
            {},
            (() => {
              const likely = mostLikelyAction(model);
              return `It is tempting to plan for the most likely state. ${model.states[likely.state]} has a ${p0(model.prior[likely.state])} chance, and ${model.actions[likely.action]} is best for it. But that leaves a ${p0(
                1 - model.prior[likely.state],
              )} chance of something else, where ${model.actions[likely.action]} does badly. EMV counts every state, weighted by how likely it is.`;
            })(),
          )
        : h("p", {}, `Without any forecast, the best action is ${model.actions[blind.action]}, worth ${k(blind.value)}.`),
    ),
  });

  const perfectValue = valueWithPerfectInfo(model);
  const ceiling = evpi(model);
  const perfectLine = `${model.states.map((s, si) => `${fmt(model.prior[si], 1)} × ${paren(Math.max(...model.payoff.map((row) => row[si])))}`).join(" + ")} = ${k(perfectValue)}`;

  if (f) {
    const j = joint(model);
    const post = posteriors(model);
    const plan = bestPlan(model);
    const counts = jointCounts(model);
    const withF = valueWithForecast(model);
    const perReport = f.reports.map((r, ri) => {
      const a = plan[ri];
      const v = model.payoff[a].reduce((s, pay, si) => s + pay * j[si][ri], 0);
      return { r, a, v, line: `It ${r} (${counts[0][ri] + counts[1][ri]} of 100): ${model.actions[a]} → ${model.payoff[a].map((pay, si) => `${fmt(j[si][ri], 2)} × ${paren(pay)}`).join(" + ")} = ${k(v)}` };
    });
    const worth = score.worth;
    out.push({
      title: "What is the forecast worth?",
      body: h(
        "div",
        {},
        h(
          "p",
          {},
          `A report changes the odds (Bayes' rule). Before any report, strong demand has a ${p0(model.prior[0])} chance. After it ${f.reports[0]}, that becomes ${counts[0][0]} of ${counts[0][0] + counts[1][0]}, or ${p0(post[0][0])}. After it ${f.reports[1]}, it becomes ${counts[0][1]} of ${
            counts[0][1] + counts[1][1]
          }, or ${p0(post[1][0])}.`,
        ),
        h("p", {}, "For each report, pick the action that is best with the new odds, then add up over both reports:"),
        perReport.map((x) => h("p", { class: "g-formula" }, x.line)),
        h("p", { class: "g-formula" }, `With the forecast: ${perReport.map((x) => k(x.v)).join(" + ")} = ${k(withF)}.  Without it: ${k(blind.value)}.`),
        h(
          "p",
          {},
          "The value of the forecast is the difference: ",
          h("b", {}, k(worth)),
          worth > 0 ? ". " : ", because you would take the same action either way. ",
          `The seller asked ${k(model.price)}, so buying it ${worth > model.price ? `adds ${k(worth - model.price)}` : `loses ${k(model.price - worth)}`} on average. You said you would pay up to ${k(decision.bid)}.`,
        ),
      ),
    });
    out.push({
      title: "Perfect information is the ceiling",
      body: h(
        "div",
        {},
        h("p", {}, "With perfect information you would always take the best action for the demand that is coming:"),
        h("p", { class: "g-formula" }, perfectLine),
        h(
          "p",
          {},
          `That is ${k(ceiling)} more than the ${k(blind.value)} you expect with no information. This gap is the expected value of perfect information (EVPI). No forecast can be worth more, so never pay more than ${k(ceiling)} for any forecast here. `,
          model.kind === "perfect"
            ? "This level's forecast was perfect, so it was worth the full EVPI."
            : `${worth > 0 ? `This forecast makes mistakes, so it was worth only ${k(worth)}.` : "This forecast was worth $0, far below the ceiling."} ${
                model.price < ceiling && model.price > worth ? `Its price of ${k(model.price)} was under the ceiling but over its real value: the ceiling can rule a price out, but it can't rule one in.` : ""
              }`,
        ),
      ),
    });
    if (model.kind === "worthless") {
      out.push({
        title: "Why was this forecast worth nothing?",
        body: model.coin
          ? `<p>This ${f.source} ${f.reports[0]} ${p0(f.likelihood[0][0])} of the time whether demand will be strong or weak. A report that doesn't depend on the truth can't change the odds: strong demand stays at ${p0(
              model.prior[0],
            )} whatever it says. It is a coin flip with a price tag.</p>`
          : `<p>This ${f.source} does carry information: it moves the chance of strong demand from ${p0(model.prior[0])} to ${p0(post[0][0])} or ${p0(post[1][0])}. But ${
              model.actions[blind.action]
            } is the best action in both cases, so you would do the same thing whatever it says.</p><p>Information is only worth money if it could change your decision.</p>`,
      });
    }
  } else {
    out.push({
      title: "What would information be worth?",
      body: h(
        "div",
        {},
        h("p", {}, "Suppose you could know the demand before choosing. You would always take the best action for that demand:"),
        h("p", { class: "g-formula" }, perfectLine),
        h(
          "p",
          {},
          `That is ${k(ceiling)} more than the best you can expect without knowing (${k(blind.value)}). This gap is the expected value of perfect information (EVPI): the most any forecast could be worth here. In the next levels a forecast is for sale, and you decide what to pay.`,
        ),
      ),
    });
  }
  return out;
}
