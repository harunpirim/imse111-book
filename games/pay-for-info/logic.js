// Pure logic for Pay for Info?: expected monetary value (EMV), Bayes' rule,
// the expected value of perfect and of sample information (EVPI, EVSI), the
// EMV-best policy, and a repeated-play simulation. No DOM access.
//
// Money is in thousands of dollars ($k). A model is
//   { actions: [name], states: [name], prior: [p], payoff: [action][state],
//     forecast: null | { reports: [name], likelihood: [state][report] }, price }

export const PLAYS = 2000; // how many times the decision is replayed on the results screen

export const LEVELS = [
  { id: "1", name: "Best bet", blurb: "no forecast", kind: "none" },
  { id: "2", name: "Crystal ball", blurb: "a perfect forecast", kind: "perfect" },
  { id: "3", name: "Market survey", blurb: "right most of the time", kind: "imperfect" },
  { id: "4", name: "Second opinion", blurb: "worth anything?", kind: "worthless" },
];

/** The model's simplifying assumptions, shown on the intro and results screens. */
export const ASSUMPTIONS = [
  "The decision maker is risk-neutral and maximizes expected monetary value (EMV): the probability-weighted average payoff.",
  "The states of nature (how demand turns out) are mutually exclusive and cover every possibility, with known prior probabilities.",
  "The payoff for each action-state pair is known.",
  "The forecast's accuracy (its likelihoods) is known, so priors are updated with Bayes' rule.",
  `Information is bought before deciding and doesn't change the outcome. It is a one-time decision. The game replays it ${PLAYS.toLocaleString("en-US")} times only to show the long-run average.`,
  "The expected value of perfect information is the most any forecast can be worth.",
  "You name your highest price before you see the seller's price. You buy, at the seller's price, only if it is no higher than yours. There is no haggling.",
];

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const argmax = (xs) => xs.reduce((best, x, i) => (x > xs[best] + 1e-9 ? i : best), 0);

// ---- Deciding without a forecast -------------------------------------------

/** Expected monetary value of each action under the prior. */
export function emvs(model) {
  return model.payoff.map((row) => sum(row.map((v, s) => v * model.prior[s])));
}

/** The action with the highest EMV, and that EMV. */
export function bestBlind(model) {
  const e = emvs(model);
  const action = argmax(e);
  return { action, value: e[action] };
}

/** The tempting shortcut: plan for the most likely state only. */
export function mostLikelyAction(model) {
  const state = argmax(model.prior);
  return { state, action: argmax(model.payoff.map((row) => row[state])) };
}

/** Expected payoff if you always knew the state before choosing. */
export function valueWithPerfectInfo(model) {
  return sum(model.prior.map((p, s) => p * Math.max(...model.payoff.map((row) => row[s]))));
}

/** Expected value of perfect information: the ceiling on what any forecast is worth. */
export function evpi(model) {
  return valueWithPerfectInfo(model) - bestBlind(model).value;
}

// ---- Deciding with a forecast (Bayes' rule) --------------------------------

/** joint[state][report] = P(state and report). */
export function joint(model) {
  return model.prior.map((p, s) => model.forecast.likelihood[s].map((l) => p * l));
}

/** P(report) for each report. */
export function reportProbabilities(model) {
  const j = joint(model);
  return model.forecast.reports.map((_, r) => sum(j.map((row) => row[r])));
}

/** posterior[report][state] = P(state | report), by Bayes' rule. null for a report that can't happen. */
export function posteriors(model) {
  const j = joint(model);
  const pr = reportProbabilities(model);
  return pr.map((p, r) => (p > 0 ? j.map((row) => row[r] / p) : null));
}

/** Whole-number version of the joint table: out of `base` similar decisions, how many land in each cell. */
export function jointCounts(model, base = 100) {
  return joint(model).map((row) => row.map((p) => Math.round(p * base)));
}

/** For each report, the action with the highest expected payoff given that report. */
export function bestPlan(model) {
  const j = joint(model);
  return model.forecast.reports.map((_, r) => argmax(model.payoff.map((row) => sum(row.map((v, s) => v * j[s][r])))));
}

/** Expected payoff (before paying for it) when you follow `plan[report]` after each report. */
export function valueWithForecast(model, plan = bestPlan(model)) {
  const j = joint(model);
  return sum(plan.map((a, r) => sum(model.payoff[a].map((v, s) => v * j[s][r]))));
}

/** Expected value of the forecast (EVSI; equal to EVPI when the forecast is perfect). Never negative. */
export function evsi(model) {
  if (!model.forecast) return 0;
  return Math.max(0, valueWithForecast(model) - bestBlind(model).value);
}

// ---- Policies --------------------------------------------------------------

/** You buy when the seller's price is no higher than your bid. */
export function buys(bid, price) {
  return bid >= price;
}

/**
 * Expected net payoff of a policy { buy, action, plan }.
 * buy = false: take `action`. buy = true: pay the price, then take plan[report].
 */
export function policyValue(model, policy) {
  if (!policy.buy) return emvs(model)[policy.action];
  return valueWithForecast(model, policy.plan) - model.price;
}

/** The EMV-best policy at the seller's price: buy only if the forecast is worth more than it costs. */
export function optimalPolicy(model) {
  const blind = bestBlind(model);
  if (model.forecast && evsi(model) > model.price + 1e-9) return { buy: true, action: blind.action, plan: bestPlan(model) };
  return { buy: false, action: blind.action, plan: null };
}

/**
 * Replay the decision n times. Every policy faces the same sequence of states
 * and reports, so differences come from the policies, not from luck.
 */
export function simulate(model, policies, rng, n = PLAYS) {
  const draw = (probs) => {
    let u = rng.next();
    for (let i = 0; i < probs.length; i++) {
      u -= probs[i];
      if (u < 0) return i;
    }
    return probs.length - 1;
  };
  const plays = [];
  for (let k = 0; k < n; k++) {
    const state = draw(model.prior);
    const report = model.forecast ? draw(model.forecast.likelihood[state]) : null;
    plays.push({ state, report });
  }
  const results = policies.map((policy) => {
    let total = 0;
    const payoffs = [];
    const running = [];
    plays.forEach(({ state, report }, k) => {
      const action = policy.buy ? policy.plan[report] : policy.action;
      const net = model.payoff[action][state] - (policy.buy ? model.price : 0);
      total += net;
      payoffs.push(net);
      running.push(total / (k + 1));
    });
    return { payoffs, running, mean: total / n };
  });
  return { plays, results };
}

/**
 * Stars. regret = EMV lost compared with the best policy. scale = what is at
 * stake (EVPI, or the spread of EMVs when there is no forecast). bidGap = how
 * far your highest price was from the forecast's true value (0 if no bid).
 */
export function starsFor({ regret, scale, bidGap = 0 }) {
  if (regret <= 1e-9) return bidGap <= Math.max(1, 0.1 * scale) ? 3 : 2;
  if (regret <= 0.1 * scale) return 2;
  if (regret <= 0.5 * scale) return 1;
  return 0;
}

/** Score a finished round. decision = { bid, action, plan } (bid and plan are null without a forecast). */
export function scoreRound(model, decision) {
  const buy = !!model.forecast && decision.bid != null && buys(decision.bid, model.price);
  const you = { buy, action: decision.action, plan: buy ? decision.plan : null };
  const best = optimalPolicy(model);
  const blind = { buy: false, action: bestBlind(model).action, plan: null };
  const value = { you: policyValue(model, you), best: policyValue(model, best), blind: policyValue(model, blind) };
  const e = emvs(model);
  const scale = model.forecast ? evpi(model) : Math.max(...e) - Math.min(...e);
  const worth = evsi(model);
  const bidGap = model.forecast ? Math.abs(decision.bid - worth) : 0;
  const regret = Math.max(0, value.best - value.you);
  return { you, best, blind, value, regret, scale, worth, bidGap, stars: starsFor({ regret, scale, bidGap }) };
}

// ---- Round generation ------------------------------------------------------

const THEMES = [
  {
    story: "Your company is launching a new snack bar. You must set the size of the first production run before you know how well it will sell.",
    sizes: ["Large run", "Medium run", "Small run"],
    source: "market survey",
  },
  {
    story: "Your company is building a plant for a new product line. You must choose its size before you know how strong demand will be.",
    sizes: ["Large plant", "Medium plant", "Small plant"],
    source: "demand study",
  },
  {
    story: "Your store must order winter jackets months before the season. You must choose the order size before you know how the season will sell.",
    sizes: ["Big order", "Medium order", "Small order"],
    source: "trend report",
  },
];
const PRIORS3 = [
  [0.5, 0.3, 0.2],
  [0.5, 0.2, 0.3],
  [0.3, 0.5, 0.2],
  [0.2, 0.5, 0.3],
  [0.2, 0.3, 0.5],
  [0.3, 0.2, 0.5],
  [0.4, 0.3, 0.3],
  [0.3, 0.4, 0.3],
];
const tens = (rng, lo, hi) => 10 * rng.int(lo / 10, hi / 10);
const tenth = (x) => Math.round(x * 10) / 10;

function sample(make, ok, tries = 3000) {
  let c = make();
  for (let k = 1; k < tries && !ok(c); k++) c = make();
  return c;
}

/** Level 1: three sizes, three demand levels, no forecast. The "most likely state" shortcut picks the wrong action. */
function threeByThree(rng, theme) {
  return sample(
    () => {
      const sm = tens(rng, 30, 60);
      const small = [sm + tens(rng, 0, 20), sm, Math.max(0, sm - tens(rng, 10, 30))];
      const medium = [small[0] + tens(rng, 30, 60), small[1] + tens(rng, 10, 30), small[2] - tens(rng, 20, 50)];
      const large = [medium[0] + tens(rng, 40, 90), medium[1] - tens(rng, 10, 40), medium[2] - tens(rng, 40, 90)];
      return {
        story: theme.story,
        actions: theme.sizes,
        states: ["High demand", "Medium demand", "Low demand"],
        prior: rng.pick(PRIORS3),
        payoff: [large, medium, small],
        forecast: null,
        price: 0,
      };
    },
    (m) => {
      const e = emvs(m).slice().sort((a, b) => b - a);
      return e[0] - e[1] >= 3 && e[1] - e[2] >= 3 && mostLikelyAction(m).action !== bestBlind(m).action;
    },
  );
}

/** Levels 2 to 4: a large and a small option, strong or weak demand. */
function twoByTwo(rng, theme) {
  const pStrong = rng.pick([0.3, 0.4, 0.5, 0.6, 0.7]);
  return {
    story: theme.story,
    actions: [theme.sizes[0], theme.sizes[2]],
    states: ["Strong demand", "Weak demand"],
    prior: [pStrong, tenth(1 - pStrong)],
    payoff: [
      [tens(rng, 100, 200), -tens(rng, 20, 100)],
      [tens(rng, 40, 90), tens(rng, 10, 40)],
    ],
    forecast: null,
    price: 0,
  };
}

function withForecast(model, theme, accStrong, accWeak, label) {
  return {
    ...model,
    forecast: {
      source: label || theme.source,
      reports: ['says "strong"', 'says "weak"'],
      likelihood: [
        [accStrong, tenth(1 - accStrong)],
        [tenth(1 - accWeak), accWeak],
      ],
    },
  };
}

/** A whole-$k price clearly below (worth it) or clearly above (not worth it) the forecast's value. */
function priceFor(rng, value, ceiling, worthIt) {
  if (worthIt) return Math.max(1, Math.min(Math.ceil(value) - 1, Math.round(value * rng.uniform(0.4, 0.8))));
  const lo = Math.floor(value) + 1;
  const hi = Math.max(lo, Math.ceil(ceiling) - 1);
  return rng.int(lo, Math.max(lo, Math.min(hi, Math.round(value * 1.8) + 1)));
}

/** Generate one decision for a level from a seeded generator. */
export function generateRound(rng, level) {
  const theme = rng.pick(THEMES);
  if (level.kind === "none") return { kind: level.kind, ...threeByThree(rng, theme) };

  if (level.kind === "perfect") {
    const model = sample(
      () => withForecast(twoByTwo(rng, theme), theme, 1, 1, "test market that is never wrong"),
      (m) => evpi(m) >= 8 && m.payoff[0][0] > m.payoff[1][0] && Math.abs(emvs(m)[0] - emvs(m)[1]) >= 3,
    );
    const worthIt = rng.chance(0.5);
    return { kind: level.kind, ...model, worthIt, price: worthIt ? priceFor(rng, evpi(model), evpi(model), true) : Math.round(evpi(model) * rng.uniform(1.2, 1.7)) + 1 };
  }

  if (level.kind === "imperfect") {
    const model = sample(
      () => withForecast(twoByTwo(rng, theme), theme, rng.pick([0.7, 0.8, 0.9]), rng.pick([0.6, 0.7, 0.8, 0.9])),
      (m) => evsi(m) >= 3 && evsi(m) <= 0.75 * evpi(m) && evpi(m) - evsi(m) >= 3 && Math.abs(emvs(m)[0] - emvs(m)[1]) >= 3,
    );
    const worthIt = rng.chance(0.5);
    // When it isn't worth it, the price still sits under the EVPI ceiling: cheap enough to tempt.
    return { kind: level.kind, ...model, worthIt, price: priceFor(rng, evsi(model), evpi(model), worthIt) };
  }

  // Worthless forecast: either it never changes the best action, or it is a coin flip.
  const coin = rng.chance(0.4);
  const model = sample(
    () => {
      const base = twoByTwo(rng, theme);
      if (coin) {
        const q = rng.pick([0.4, 0.5, 0.6]);
        return withForecast(base, theme, q, tenth(1 - q), "online poll");
      }
      return withForecast(base, theme, rng.pick([0.6, 0.7]), rng.pick([0.6, 0.7]), "second opinion");
    },
    (m) => {
      if (evpi(m) < 8 || Math.abs(emvs(m)[0] - emvs(m)[1]) < 5) return false;
      if (valueWithForecast(m) - bestBlind(m).value > 1e-9) return false;
      // Clearly the same action after either report (no near-ties).
      const j = joint(m);
      return m.forecast.reports.every((_, r) => {
        const v = m.payoff.map((row) => sum(row.map((x, s) => x * j[s][r])));
        return Math.abs(v[0] - v[1]) >= 0.5;
      });
    },
  );
  return { kind: level.kind, ...model, coin, worthIt: false, price: Math.max(2, Math.round(evpi(model) * rng.uniform(0.2, 0.6))) };
}
