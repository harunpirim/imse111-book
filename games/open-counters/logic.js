// Pure logic for the Open Counters game: a service desk with one line and
// several counters, simulated customer by customer, plus the M/M/c (Erlang C)
// formulas used as the benchmark. No DOM access, so it runs in node --test.
//
// Vocabulary
//   day    { rates (customers per hour, one per period), mu (customers per hour per counter),
//            staffCost ($ per counter-hour), waitCost ($ per customer-hour in line),
//            maxCounters, arrivals (minutes after opening), services (minutes) }
//   plan   number of open counters for each period
//
// Times inside the simulation are minutes after opening. Rates are per hour.

export const PERIOD_MIN = 60; // counters can only change on the hour
export const REPLICATIONS = 200; // simulated days behind the long-run averages
export const STAR_RATIOS = [1.03, 1.15]; // 3 stars within 3% of the formula plan's long-run cost, 2 stars within 15%

/** The model's simplifying assumptions, shown on the intro and results screens. */
export const ASSUMPTIONS = [
  "Customers arrive one at a time at random (Poisson) at a known average rate, constant within each hour.",
  "Service times are random (exponential) and independent, and every counter works at the same rate.",
  "One line feeds all open counters (an M/M/c queue), first come, first served.",
  "No one leaves the line, there is no limit on queue length, and the customer population is effectively infinite.",
  `The desk opens empty. Counters open and close only on the hour (every ${PERIOD_MIN} minutes), and a counter that closes finishes its current customer first. At closing time no new customers come in, and everyone still in line is served.`,
  "Cost = counter (staff) cost per hour + customer waiting cost per hour. Staff are paid for every scheduled counter-hour, plus any time spent serving after closing. Waiting cost counts time in line, not time at the counter.",
  `The formula benchmark (Erlang C) gives long-run averages, which need arrival rate < c × service rate. It treats each hour as if it ran forever, so it is a strong benchmark, not a guaranteed best plan for one short day. The animation shows one random day, so stars use the average over ${REPLICATIONS} simulated days.`,
];

export const LEVELS = [
  {
    id: "1",
    name: "Steady morning",
    blurb: "4 hours · same arrival rate all morning",
    desk: "Campus IT help desk",
    customer: "student",
    openHour: 8,
    shape: [35, 35, 35, 35],
    flat: true,
    jitter: [0.955, 1.0], // 33 to 35 per hour: three counters would be 92% to 97% busy
    mu: 12,
    staffCost: 20,
    waitCost: 15,
    maxCounters: 6,
  },
  {
    id: "2",
    name: "Lunch rush",
    blurb: "6 hours · one big peak",
    desk: "Student ID card office",
    customer: "student",
    openHour: 10,
    shape: [15, 28, 44, 40, 22, 14],
    mu: 12,
    staffCost: 20,
    waitCost: 15,
    maxCounters: 8,
  },
  {
    id: "3",
    name: "First week of class",
    blurb: "8 hours · two peaks, long lines",
    desk: "Campus IT help desk",
    customer: "student",
    openHour: 9,
    shape: [30, 46, 58, 64, 50, 60, 42, 26],
    mu: 12,
    staffCost: 20,
    waitCost: 15,
    maxCounters: 10,
  },
  {
    id: "4",
    name: "Tool crib",
    blurb: "8 hours · waiting is expensive",
    desk: "Machine shop tool crib",
    customer: "machinist",
    openHour: 7,
    shape: [36, 50, 30, 24, 44, 52, 28, 18],
    mu: 20,
    staffCost: 22,
    waitCost: 45,
    maxCounters: 8,
  },
  {
    id: "5",
    name: "Tight budget",
    blurb: "8 hours · slow service, costly staff",
    desk: "Advising walk-in desk",
    customer: "student",
    openHour: 9,
    shape: [10, 16, 24, 20, 14, 22, 12, 8],
    mu: 6,
    staffCost: 32,
    waitCost: 8,
    maxCounters: 8,
  },
];

/** One exponential draw with the given rate (mean 1 / rate). */
function exponential(rng, rate) {
  return -Math.log(1 - rng.next()) / rate;
}

/**
 * One random day for the given hourly arrival rates: arrival times (a Poisson
 * process whose rate is constant within each period) and a service time for
 * every customer. All times in minutes.
 */
export function sampleDay(base, rng) {
  const arrivalRng = rng.fork("arrivals");
  const serviceRng = rng.fork("service");
  const arrivals = [];
  base.rates.forEach((rate, p) => {
    // Gaps between arrivals are exponential; restarting at each hour is fine because the process has no memory.
    let t = p * PERIOD_MIN + exponential(arrivalRng, rate / 60);
    while (t < (p + 1) * PERIOD_MIN) {
      arrivals.push(t);
      t += exponential(arrivalRng, rate / 60);
    }
  });
  const services = arrivals.map(() => exponential(serviceRng, base.mu / 60));
  return { ...base, arrivals, services };
}

/**
 * Build a level's day from the round's random numbers.
 * @param {object} rng   from shared/rng.js
 * @param {object} spec  one of LEVELS
 */
export function generateDay(rng, spec) {
  const [lo, hi] = spec.jitter || [0.85, 1.15];
  const flat = rng.uniform(lo, hi);
  const rates = spec.shape.map((r) => Math.max(2, Math.round(r * (spec.flat ? flat : rng.uniform(lo, hi)))));
  const base = {
    desk: spec.desk,
    customer: spec.customer,
    openHour: spec.openHour,
    periods: rates.length,
    rates,
    mu: spec.mu,
    staffCost: spec.staffCost,
    waitCost: spec.waitCost,
    maxCounters: spec.maxCounters,
  };
  return sampleDay(base, rng.fork("day"));
}

/**
 * A step-by-step simulation of one day. advance(T) plays it forward to minute
 * T; the plan is read at the start of each period, so later periods can still
 * be changed while the day is running.
 */
export function createSim(day, plan) {
  const { arrivals, services, periods, maxCounters } = day;
  const close = periods * PERIOD_MIN;
  const n = arrivals.length;
  const start = new Float64Array(n).fill(NaN);
  const slots = new Array(Math.max(maxCounters, ...plan)).fill(-1); // customer at each counter, or -1
  const slotEnd = new Array(slots.length).fill(Infinity);
  const queue = [];
  let t = 0;
  let next = 0; // next customer to arrive
  let busy = 0;
  let served = 0;
  let queueArea = 0; // customer-minutes spent in line so far
  let busyArea = 0; // counter-minutes spent serving so far
  let paidArea = 0; // counter-minutes paid for so far
  let overtimeArea = 0; // counter-minutes of serving after closing
  let maxQueue = 0;
  let finished = false;
  const trace = [{ t: 0, q: 0 }];

  const target = (time) => Math.max(1, plan[Math.min(periods - 1, Math.floor(time / PERIOD_MIN + 1e-9))]);

  function dispatch() {
    while (queue.length && busy < target(t)) {
      const i = queue.shift();
      const s = slots.indexOf(-1);
      slots[s] = i;
      slotEnd[s] = t + services[i];
      start[i] = t;
      busy += 1;
    }
  }

  function advance(T) {
    while (!finished) {
      const tArrive = next < n ? arrivals[next] : Infinity;
      const tDone = Math.min(...slotEnd);
      const tBoundary = t < close ? (Math.floor(t / PERIOD_MIN + 1e-9) + 1) * PERIOD_MIN : Infinity;
      const te = Math.min(tArrive, tDone, tBoundary);
      const stop = Math.min(te, T);
      const dt = stop - t;
      if (dt > 0) {
        queueArea += queue.length * dt;
        busyArea += busy * dt;
        if (t < close) paidArea += target(t) * dt;
        else {
          paidArea += busy * dt;
          overtimeArea += busy * dt;
        }
        t = stop;
      }
      if (te > T) break;
      const before = queue.length;
      if (tDone <= te) {
        for (let s = 0; s < slots.length; s++) {
          if (slotEnd[s] <= te) {
            slots[s] = -1;
            slotEnd[s] = Infinity;
            busy -= 1;
            served += 1;
          }
        }
      }
      if (tArrive <= te) {
        queue.push(next);
        next += 1;
      }
      dispatch();
      if (queue.length > maxQueue) maxQueue = queue.length;
      if (queue.length !== before) trace.push({ t, q: queue.length });
      if (t >= close && next >= n && !queue.length && busy === 0) {
        finished = true;
        trace.push({ t, q: 0 });
      }
    }
    return api;
  }

  const api = {
    advance,
    get time() {
      return t;
    },
    get finished() {
      return finished;
    },
    /** A snapshot for drawing: who is in line, who is at each counter, and running totals. */
    state() {
      return {
        t,
        finished,
        period: Math.min(periods - 1, Math.floor(t / PERIOD_MIN + 1e-9)),
        open: target(t),
        queue: queue.slice(),
        slots: slots.slice(),
        arrived: next,
        served,
        busy,
        maxQueue,
        avgWait: next ? queueArea / next : 0,
        utilization: paidArea ? busyArea / paidArea : 0,
        staffCost: (day.staffCost * paidArea) / 60,
        waitCost: (day.waitCost * queueArea) / 60,
        trace,
      };
    },
    /** Final numbers. Call after advance(Infinity). */
    summary() {
      const waits = Array.from(start, (s, i) => s - arrivals[i]);
      const scheduled = plan.slice(0, periods).reduce((a, c) => a + Math.max(1, c), 0);
      const staffCost = day.staffCost * (scheduled + overtimeArea / 60);
      const waitCost = (day.waitCost * queueArea) / 60;
      const perPeriod = day.rates.map((_, p) => {
        const mine = waits.filter((_, i) => Math.floor(arrivals[i] / PERIOD_MIN) === p);
        return { arrivals: mine.length, avgWait: mine.length ? mine.reduce((a, b) => a + b, 0) / mine.length : 0 };
      });
      return {
        customers: n,
        waits,
        avgWait: n ? queueArea / n : 0,
        maxWait: n ? Math.max(...waits) : 0,
        maxQueue,
        utilization: paidArea ? busyArea / paidArea : 0,
        counterHours: scheduled,
        overtimeMin: Math.max(0, t - close),
        staffCost,
        waitCost,
        totalCost: staffCost + waitCost,
        endTime: t,
        trace,
        perPeriod,
      };
    },
  };
  return api;
}

/** Simulate a whole day with a fixed plan and return its summary. */
export function simulate(day, plan) {
  return createSim(day, plan).advance(Infinity).summary();
}

/**
 * Long-run averages for a plan: simulate many random days with the same
 * arrival rates. The same `rng` gives every plan the same days, so plans are
 * compared on equal luck.
 */
export function replicate(day, plan, rng, reps = REPLICATIONS) {
  const sum = { totalCost: 0, staffCost: 0, waitCost: 0, avgWait: 0, utilization: 0, maxQueue: 0 };
  for (let r = 0; r < reps; r++) {
    const s = simulate(sampleDay(day, rng.fork(`rep-${r}`)), plan);
    for (const k of Object.keys(sum)) sum[k] += s[k];
  }
  for (const k of Object.keys(sum)) sum[k] /= reps;
  return { ...sum, reps };
}

/** Utilization: the share of counter capacity that arriving work needs, lambda / (c * mu). */
export function utilization(lambda, mu, c) {
  return lambda / (c * mu);
}

/**
 * Erlang C: the long-run chance that an arriving customer has to wait in an
 * M/M/c queue with offered load a = lambda / mu. Needs a < c.
 */
export function erlangC(c, a) {
  if (a >= c) return 1;
  let b = 1; // Erlang B, built up one counter at a time
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  const rho = a / c;
  return b / (1 - rho * (1 - b));
}

/**
 * Long-run M/M/c results for one period.
 * Lq = average number in line, Wq = average wait in line (minutes).
 */
export function mmc(lambda, mu, c) {
  const rho = utilization(lambda, mu, c);
  if (rho >= 1) return { rho, stable: false, pWait: 1, Lq: Infinity, Wq: Infinity };
  const pWait = erlangC(c, lambda / mu);
  const Lq = (pWait * rho) / (1 - rho);
  return { rho, stable: true, pWait, Lq, Wq: lambda > 0 ? (Lq / lambda) * 60 : 0 };
}

/** Long-run cost per hour with c counters: staff + waiting (Lq customers are in line on average). */
export function hourlyCost(lambda, mu, c, staffCost, waitCost) {
  return staffCost * c + waitCost * mmc(lambda, mu, c).Lq;
}

/** Fewest counters that keep up with arrivals: the smallest c with lambda < c * mu. */
export function minCounters(lambda, mu) {
  return Math.floor(lambda / mu + 1e-9) + 1;
}

/** The number of counters with the lowest long-run hourly cost (Erlang C). */
export function bestCounters(lambda, mu, staffCost, waitCost, maxCounters = 50) {
  let best = null;
  for (let c = minCounters(lambda, mu); c <= maxCounters; c++) {
    const cost = hourlyCost(lambda, mu, c, staffCost, waitCost);
    if (!best || cost < best.cost - 1e-9) best = { c, cost };
  }
  return best ? best.c : maxCounters;
}

/** The benchmark: the Erlang C best number of counters in every period. */
export function formulaPlan(day) {
  return day.rates.map((r) => bestCounters(r, day.mu, day.staffCost, day.waitCost, day.maxCounters));
}

/**
 * The period where running with the fewest possible counters is tightest
 * (utilization closest to 100%). It makes the clearest example of how waits
 * grow near full utilization.
 */
export function tightestPeriod(day) {
  let best = 0;
  day.rates.forEach((r, p) => {
    const u = (q) => utilization(day.rates[q], day.mu, minCounters(day.rates[q], day.mu));
    if (u(p) > u(best) + 1e-12) best = p;
  });
  return best;
}

/** A lean plan that looks efficient on paper: just enough counters to keep utilization under 100%. */
export function leanPlan(day) {
  return day.rates.map((r) => Math.min(day.maxCounters, minCounters(r, day.mu)));
}

/** Stars from long-run cost: 3 = within 3% of the formula plan (or better), 2 = within 15%, 1 otherwise. */
export function starsFor(cost, benchmark) {
  const ratio = benchmark > 0 ? cost / benchmark : 1;
  if (ratio <= STAR_RATIOS[0]) return 3;
  if (ratio <= STAR_RATIOS[1]) return 2;
  return 1;
}

/** "9:00", "13:30" for a time in minutes after opening. */
export function clock(day, minutes) {
  const total = Math.floor(day.openHour * 60 + minutes + 1e-9);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
