// Pure logic for the Route Rush game: map generation, route checks, and
// benchmark solutions (nearest neighbor, 2-opt, exact optimum, local search).
// No DOM access, so it runs in node --test.
//
// Vocabulary
//   node      { id, label, x, y, demand }   id 0 is the depot (demand 0)
//   instance  { nodes, n (customers), trucks, capacity (Infinity = no limit), totalDemand }
//   route     array of customer ids in visiting order (depot is implied at both ends)
//   plan      array of routes, one per truck
//
// A plan is feasible when every customer is on exactly one route, no route
// carries more than the capacity, and no more routes are used than there are trucks.

export const MAP_KM = 10; // the map is a MAP_KM x MAP_KM square
export const GRID = 100; // coordinates are whole numbers 0..GRID (one unit = MAP_KM / GRID km)
export const KM_PER_UNIT = MAP_KM / GRID;
export const EXACT_LIMIT = 12; // largest number of customers solved to proven optimality
export const EPS = 1e-7;

/**
 * The model's simplifying assumptions, shown on the intro and results screens.
 * Numbers come from the constants above so the text can't drift from the code.
 */
export const ASSUMPTIONS = [
  "One depot. Every vehicle starts and ends there.",
  "Identical vehicles with the same capacity. Every customer is visited exactly once by one vehicle, and an order is never split between vehicles.",
  "Customer locations and demands are known in advance, and nothing changes during the day.",
  `Distance is straight-line (Euclidean) on a ${MAP_KM} km × ${MAP_KM} km map and the same in both directions. Cost is proportional to distance only: no roads, traffic, time windows or service times.`,
  "The fleet size is fixed. You may leave a truck unused, but you can't add one.",
  `"Optimal" means the proven shortest total distance, found by checking every possibility on maps with up to ${EXACT_LIMIT} customers. On bigger maps the benchmark is the best plan a computer search found, which may not be the true optimum.`,
];

export const LEVELS = [
  { id: "1", name: "Campus loop", blurb: "1 truck · 6 stops · no load limit", n: 6, trucks: 1, capacitated: false },
  { id: "2", name: "Downtown loop", blurb: "1 truck · 9 stops · no load limit", n: 9, trucks: 1, capacitated: false },
  { id: "3", name: "Two trucks", blurb: "2 trucks · 8 stops · load limit", n: 8, trucks: 2, capacitated: true },
  { id: "4", name: "Three trucks", blurb: "3 trucks · 11 stops · load limit", n: 11, trucks: 3, capacitated: true },
  { id: "5", name: "Regional run", blurb: "3 trucks · 15 stops · no proven optimum", n: 15, trucks: 3, capacitated: true },
];

export function customerLabel(i) {
  return String.fromCharCode(64 + i); // 1 -> A, 2 -> B, ...
}

/** Straight-line distance between two nodes, in km. */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) * KM_PER_UNIT;
}

/** Symmetric distance matrix (km) for an instance's nodes. */
export function distanceMatrix(nodes) {
  return nodes.map((a) => nodes.map((b) => dist(a, b)));
}

/**
 * Generate a map: a depot near the middle and n customers that are not too
 * close to each other. With capacity, demands are whole boxes and the capacity
 * is set so the fleet has some spare room and the nearest-neighbor rule still
 * fits in the fleet.
 * @param {object} rng   from shared/rng.js
 * @param {object} spec  { n, trucks, capacitated }
 */
export function generateInstance(rng, spec) {
  const { n, trucks, capacitated } = spec;
  const depot = { id: 0, label: "Depot", x: rng.int(40, 60), y: rng.int(40, 60), demand: 0 };
  const nodes = [depot];
  const minGap = n > 12 ? 13 : 15;
  let guard = 0;
  while (nodes.length < n + 1) {
    const p = { x: rng.int(5, 95), y: rng.int(6, 94) };
    guard += 1;
    const gap = guard > 4000 ? 6 : minGap;
    if (nodes.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap)) {
      const id = nodes.length;
      nodes.push({ id, label: customerLabel(id), x: p.x, y: p.y, demand: capacitated ? rng.int(1, 6) : 0 });
    }
  }
  const totalDemand = nodes.reduce((s, c) => s + c.demand, 0);
  const inst = { nodes, n, trucks, capacity: Infinity, totalDemand, d: distanceMatrix(nodes) };
  if (capacitated) {
    const maxDemand = Math.max(...nodes.map((c) => c.demand));
    // About 15% spare room across the fleet; then grow until nearest neighbor fits in the fleet.
    inst.capacity = Math.max(maxDemand, Math.ceil((totalDemand * 1.15) / trucks));
    while (nearestNeighbor(inst).length > trucks) inst.capacity += 1;
  }
  return inst;
}

/** Length of one route (depot -> stops -> depot), in km. An empty route is 0. */
export function routeLength(inst, route) {
  if (!route.length) return 0;
  const d = inst.d;
  let total = d[0][route[0]];
  for (let i = 1; i < route.length; i++) total += d[route[i - 1]][route[i]];
  return total + d[route[route.length - 1]][0];
}

export function routeLoad(inst, route) {
  return route.reduce((s, id) => s + inst.nodes[id].demand, 0);
}

export function planLength(inst, plan) {
  return plan.reduce((s, r) => s + routeLength(inst, r), 0);
}

/** Live metrics for a (possibly partial) plan. */
export function evaluate(inst, plan) {
  const seen = new Map();
  const duplicates = [];
  plan.forEach((route, t) =>
    route.forEach((id) => {
      if (seen.has(id)) duplicates.push(id);
      seen.set(id, t);
    }),
  );
  const lengths = plan.map((r) => routeLength(inst, r));
  const loads = plan.map((r) => routeLoad(inst, r));
  const unvisited = inst.nodes.filter((c) => c.id !== 0 && !seen.has(c.id)).map((c) => c.id);
  const overloaded = loads.map((l, t) => (l > inst.capacity ? t : -1)).filter((t) => t >= 0);
  const used = plan.filter((r) => r.length).length;
  const complete = unvisited.length === 0;
  return {
    lengths,
    loads,
    total: lengths.reduce((a, b) => a + b, 0),
    trucksUsed: used,
    unvisited,
    overloaded,
    duplicates,
    complete,
    feasible: complete && duplicates.length === 0 && overloaded.length === 0 && used <= inst.trucks,
  };
}

/**
 * Nearest-neighbor rule: from where the truck is, always drive to the closest
 * customer not yet visited whose order still fits. When nothing fits, go home
 * and send the next truck. Returns a plan (it may need more trucks than the
 * fleet has on a tight instance; generateInstance rules that out).
 */
export function nearestNeighbor(inst) {
  const d = inst.d;
  const left = new Set(inst.nodes.slice(1).map((c) => c.id));
  const plan = [];
  while (left.size) {
    const route = [];
    let at = 0;
    let load = 0;
    for (;;) {
      let best = -1;
      for (const id of left) {
        if (load + inst.nodes[id].demand > inst.capacity) continue;
        if (best < 0 || d[at][id] < d[at][best] - EPS) best = id;
      }
      if (best < 0) break;
      route.push(best);
      left.delete(best);
      load += inst.nodes[best].demand;
      at = best;
    }
    if (!route.length) throw new Error("nearestNeighbor: an order is larger than the truck");
    plan.push(route);
  }
  return plan;
}

/**
 * 2-opt on one route: while reversing a stretch of the route makes it shorter,
 * do it. Reversing a stretch replaces two legs with two others, which is what
 * untangles a crossing. Returns the improved route and how many swaps it made.
 */
export function twoOptRoute(inst, route) {
  const d = inst.d;
  const r = [0, ...route, 0];
  let swaps = 0;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < r.length - 2; i++) {
      for (let j = i + 1; j < r.length - 1; j++) {
        const before = d[r[i]][r[i + 1]] + d[r[j]][r[j + 1]];
        const after = d[r[i]][r[j]] + d[r[i + 1]][r[j + 1]];
        if (after < before - EPS) {
          for (let a = i + 1, b = j; a < b; a++, b--) [r[a], r[b]] = [r[b], r[a]];
          swaps += 1;
          improved = true;
        }
      }
    }
  }
  return { route: r.slice(1, -1), swaps };
}

/** 2-opt applied to every route of a plan. Customers stay on their truck. */
export function twoOpt(inst, plan) {
  let swaps = 0;
  const out = plan.map((route) => {
    const res = twoOptRoute(inst, route);
    swaps += res.swaps;
    return res.route;
  });
  return { plan: out, swaps };
}

/**
 * Local search for bigger maps: 2-opt inside each route, plus moving one
 * customer to another place (same or other truck) and swapping two customers
 * between trucks, as long as loads fit. Not guaranteed optimal.
 */
export function localSearch(inst, startPlan) {
  let plan = startPlan.map((r) => r.slice());
  while (plan.length < inst.trucks) plan.push([]);
  let best = planLength(inst, plan);
  let improved = true;
  const fits = (p) => p.every((r) => routeLoad(inst, r) <= inst.capacity);
  while (improved) {
    improved = false;
    plan = twoOpt(inst, plan).plan;
    best = planLength(inst, plan);
    // Relocate one customer.
    outer: for (let a = 0; a < plan.length; a++) {
      for (let i = 0; i < plan[a].length; i++) {
        for (let b = 0; b < plan.length; b++) {
          for (let j = 0; j <= plan[b].length - (a === b ? 1 : 0); j++) {
            const cand = plan.map((r) => r.slice());
            const [c] = cand[a].splice(i, 1);
            cand[b].splice(j, 0, c);
            if (!fits(cand)) continue;
            const len = planLength(inst, cand);
            if (len < best - EPS) {
              plan = cand;
              best = len;
              improved = true;
              break outer;
            }
          }
        }
      }
    }
    if (improved) continue;
    // Swap two customers on different trucks.
    outer2: for (let a = 0; a < plan.length; a++) {
      for (let b = a + 1; b < plan.length; b++) {
        for (let i = 0; i < plan[a].length; i++) {
          for (let j = 0; j < plan[b].length; j++) {
            const cand = plan.map((r) => r.slice());
            [cand[a][i], cand[b][j]] = [cand[b][j], cand[a][i]];
            if (!fits(cand)) continue;
            const len = planLength(inst, cand);
            if (len < best - EPS) {
              plan = cand;
              best = len;
              improved = true;
              break outer2;
            }
          }
        }
      }
    }
  }
  return plan.filter((r) => r.length);
}

/** Sweep start: sort customers by angle around the depot and cut into trucks. */
function sweepPlan(inst, offset) {
  const depot = inst.nodes[0];
  const order = inst.nodes
    .slice(1)
    .map((c) => ({ id: c.id, ang: Math.atan2(c.y - depot.y, c.x - depot.x) }))
    .sort((p, q) => p.ang - q.ang)
    .map((p) => p.id);
  const rotated = order.slice(offset).concat(order.slice(0, offset));
  const plan = [[]];
  let load = 0;
  for (const id of rotated) {
    const dem = inst.nodes[id].demand;
    if (load + dem > inst.capacity) {
      plan.push([]);
      load = 0;
    }
    plan[plan.length - 1].push(id);
    load += dem;
  }
  return plan;
}

/**
 * Best plan a computer search can find quickly: local search from the
 * nearest-neighbor plan and from every sweep start that fits the fleet.
 * Extra plans (for example the player's) can be offered as starts too.
 */
export function bestFound(inst, extraStarts = []) {
  const starts = [nearestNeighbor(inst), ...extraStarts];
  for (let k = 0; k < inst.n; k++) starts.push(sweepPlan(inst, k));
  let best = null;
  let bestLen = Infinity;
  for (const s of starts) {
    if (s.filter((r) => r.length).length > inst.trucks) continue;
    const p = localSearch(inst, s);
    if (p.length > inst.trucks) continue;
    const len = planLength(inst, p);
    if (len < bestLen - EPS) {
      best = p;
      bestLen = len;
    }
  }
  return { plan: best, length: bestLen };
}

/**
 * Exact optimum by dynamic programming over sets of customers.
 *   1. Held-Karp gives the shortest single-truck tour for every set of customers.
 *   2. A second pass splits all customers into at most `trucks` sets whose
 *      loads fit, minimizing the sum of their tours.
 * Fine up to EXACT_LIMIT customers.
 */
export function optimalPlan(inst) {
  const n = inst.n;
  if (n > EXACT_LIMIT) throw new Error("optimalPlan: too many customers");
  const d = inst.d;
  const size = 1 << n;
  const full = size - 1;
  // path[S * n + j]: shortest path from the depot through set S ending at customer j (j in S).
  const path = new Float64Array(size * n).fill(Infinity);
  const prev = new Int8Array(size * n).fill(-1);
  for (let j = 0; j < n; j++) path[(1 << j) * n + j] = d[0][j + 1];
  for (let S = 1; S < size; S++) {
    for (let j = 0; j < n; j++) {
      if (!(S & (1 << j))) continue;
      const cur = path[S * n + j];
      if (cur === Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (S & (1 << k)) continue;
        const T = S | (1 << k);
        const v = cur + d[j + 1][k + 1];
        if (v < path[T * n + k]) {
          path[T * n + k] = v;
          prev[T * n + k] = j;
        }
      }
    }
  }
  const tour = new Float64Array(size).fill(Infinity);
  const tourEnd = new Int8Array(size).fill(-1);
  const load = new Float64Array(size);
  tour[0] = 0;
  for (let S = 1; S < size; S++) {
    const low = 31 - Math.clz32(S & -S);
    load[S] = load[S & (S - 1)] + inst.nodes[low + 1].demand;
    for (let j = 0; j < n; j++) {
      if (!(S & (1 << j))) continue;
      const v = path[S * n + j] + d[j + 1][0];
      if (v < tour[S]) {
        tour[S] = v;
        tourEnd[S] = j;
      }
    }
  }
  const rebuild = (S) => {
    const out = [];
    let j = tourEnd[S];
    while (S) {
      out.unshift(j + 1);
      const p = prev[S * n + j];
      S &= ~(1 << j);
      j = p;
    }
    return out;
  };

  // best[k][S]: cheapest way to serve set S with at most k trucks.
  let best = new Float64Array(size).fill(Infinity);
  const choice = [];
  for (let S = 0; S < size; S++) if (load[S] <= inst.capacity) best[S] = tour[S];
  const firstChoice = new Int32Array(size);
  for (let S = 0; S < size; S++) firstChoice[S] = S;
  choice.push(firstChoice);
  for (let k = 2; k <= inst.trucks; k++) {
    const next = Float64Array.from(best);
    const pick = new Int32Array(size).fill(-1);
    for (let S = 1; S < size; S++) {
      const low = S & -S;
      // The route that contains the lowest customer of S is T; the rest uses k-1 trucks.
      for (let T = S; T; T = (T - 1) & S) {
        if (!(T & low) || load[T] > inst.capacity) continue;
        const v = tour[T] + best[S & ~T];
        if (v < next[S] - EPS) {
          next[S] = v;
          pick[S] = T;
        }
      }
    }
    best = next;
    choice.push(pick);
  }
  if (best[full] === Infinity) throw new Error("optimalPlan: no feasible plan");
  const plan = [];
  let S = full;
  for (let k = choice.length - 1; k >= 0 && S; k--) {
    const T = k === 0 ? S : choice[k][S];
    if (T === -1) continue; // k trucks are no better than k-1 for this set
    plan.push(rebuild(T));
    S &= ~T;
  }
  return { plan, length: best[full] };
}

/** Shortest single tour through every customer, ignoring capacity (exact when small). */
export function singleTourLength(inst) {
  const free = { ...inst, trucks: 1, capacity: Infinity };
  if (inst.n <= EXACT_LIMIT) return { length: optimalPlan(free).length, exact: true };
  return { length: bestFound(free).length, exact: false };
}

/** Fewest trucks that could carry the total demand: ceil(total demand / capacity). */
export function minTrucks(inst) {
  return Number.isFinite(inst.capacity) ? Math.ceil(inst.totalDemand / inst.capacity - 1e-9) : 1;
}

/** Number of different round trips through n customers with one truck: n! / 2. */
export function tourCount(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return n < 3 ? 1 : f / 2;
}

/** The longest single leg of a plan: { from, to, km }. */
export function longestLeg(inst, plan) {
  let best = { from: 0, to: 0, km: 0 };
  for (const route of plan) {
    const r = [0, ...route, 0];
    for (let i = 0; i + 1 < r.length; i++) {
      const km = inst.d[r[i]][r[i + 1]];
      if (km > best.km) best = { from: r[i], to: r[i + 1], km };
    }
  }
  return best;
}

/** True when segments p1-p2 and p3-p4 cross at a point inside both (shared endpoints don't count). */
function segmentsCross(p1, p2, p3, p4) {
  const side = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return side(p1, p2, p3) * side(p1, p2, p4) < 0 && side(p3, p4, p1) * side(p3, p4, p2) < 0;
}

/** Number of places where a route crosses itself, summed over the plan's routes. */
export function countCrossings(inst, plan) {
  let count = 0;
  for (const route of plan) {
    const r = [0, ...route, 0].map((id) => inst.nodes[id]);
    for (let i = 0; i + 1 < r.length; i++) {
      for (let j = i + 2; j + 1 < r.length; j++) {
        if (segmentsCross(r[i], r[i + 1], r[j], r[j + 1])) count += 1;
      }
    }
  }
  return count;
}

/** How far above the benchmark a plan is, as a fraction (0.05 = 5% longer). */
export function gap(length, benchmark) {
  return benchmark > 0 ? Math.max(0, length / benchmark - 1) : 0;
}

export const STAR_GAPS = [0.01, 0.08]; // 3 stars within 1% of the benchmark, 2 stars within 8%

/** Stars for a feasible plan: 3 = within 1% of the best, 2 = within 8%, 1 = feasible. */
export function starsFor(length, benchmark) {
  const g = gap(length, benchmark);
  if (g <= STAR_GAPS[0] + EPS) return 3;
  if (g <= STAR_GAPS[1] + EPS) return 2;
  return 1;
}
