// Pure logic for the Line Balancer game: instance generation, live metrics,
// and benchmark solutions. No DOM access, so it runs in node --test.
//
// Vocabulary
//   task         { id, label, time (s), preds: [task ids] }
//   instance     { name, tasks, takt (s), demand, availableSec, totalTime }
//   assignment   array indexed by task id: station index (0-based) or null
//
// A line is feasible when every task has a station, no station's load exceeds
// the takt time, and no task sits in an earlier station than one of its
// predecessors.

export const SHIFT_SECONDS = 450 * 60; // one 7.5-hour shift of available time

/** Divisors of the shift length, so takt = SHIFT_SECONDS / demand is a whole number. */
const TAKT_CHOICES = (() => {
  const out = [];
  for (let d = 10; d <= 600; d++) if (SHIFT_SECONDS % d === 0) out.push(d);
  return out;
})();

export const LEVELS = [
  { id: "1", name: "Birdhouse kit", blurb: "6 tasks · warm-up", n: 6, target: 3, tmin: 8, tmax: 30 },
  { id: "2", name: "Desk lamp", blurb: "8 tasks", n: 8, target: 3, tmin: 6, tmax: 34 },
  { id: "3", name: "Coffee grinder", blurb: "11 tasks", n: 11, target: 4, tmin: 5, tmax: 36 },
  { id: "4", name: "E-bike battery", blurb: "14 tasks", n: 14, target: 5, tmin: 4, tmax: 40 },
  { id: "5", name: "Rush order", blurb: "12 tasks · tight takt", n: 12, target: 6, tmin: 10, tmax: 40, tight: true },
];

export function taskLabel(i) {
  return String.fromCharCode(65 + i); // A, B, C, ...
}

/**
 * Generate a random precedence network and a demand that sets the takt time.
 * @param {object} rng   from shared/rng.js
 * @param {object} spec  { n, target, tmin, tmax, tight?, name? }
 */
export function generateInstance(rng, spec) {
  const { n, target, tmin, tmax } = spec;
  const tasks = [];
  for (let i = 0; i < n; i++) {
    const preds = [];
    if (i > 0 && (i > 1 || rng.chance(0.6)) && rng.chance(i < 3 ? 0.55 : 0.92)) {
      const lo = Math.max(0, i - 4);
      preds.push(rng.int(lo, i - 1));
      if (i > 2 && rng.chance(0.35)) {
        const p2 = rng.int(Math.max(0, i - 5), i - 1);
        if (!preds.includes(p2)) preds.push(p2);
      }
    }
    preds.sort((a, b) => a - b);
    tasks.push({ id: i, label: taskLabel(i), time: rng.int(tmin, tmax), preds });
  }
  // Tie every task without successors (except the last) into the final task,
  // so the network ends in one "pack and inspect" step.
  const hasSucc = new Set(tasks.flatMap((t) => t.preds));
  const last = tasks[n - 1];
  for (let i = 0; i < n - 1; i++) {
    if (!hasSucc.has(i) && !last.preds.includes(i)) last.preds.push(i);
  }
  last.preds.sort((a, b) => a - b);

  const totalTime = tasks.reduce((s, t) => s + t.time, 0);
  const maxTime = Math.max(...tasks.map((t) => t.time));
  const slack = spec.tight ? rng.uniform(1.0, 1.04) : rng.uniform(1.03, 1.12);
  const want = Math.max(maxTime, (totalTime / target) * slack);
  const takt = TAKT_CHOICES.find((d) => d >= want) ?? Math.ceil(want);
  const demand = Math.round(SHIFT_SECONDS / takt);
  return { name: spec.name || "Assembly line", tasks, takt, demand, availableSec: SHIFT_SECONDS, totalTime };
}

/** Takt time = available time / demand (seconds per unit). */
export function taktTime(availableSec, demand) {
  return availableSec / demand;
}

/** Theoretical minimum number of stations: ceil(sum of task times / takt). */
export function theoreticalMinStations(inst) {
  return Math.ceil(inst.totalTime / inst.takt - 1e-9);
}

/** Transitive successors of every task. */
export function successorSets(tasks) {
  const direct = tasks.map(() => []);
  tasks.forEach((t) => t.preds.forEach((p) => direct[p].push(t.id)));
  const memo = new Map();
  const visit = (i) => {
    if (memo.has(i)) return memo.get(i);
    const s = new Set();
    for (const j of direct[i]) {
      s.add(j);
      visit(j).forEach((k) => s.add(k));
    }
    memo.set(i, s);
    return s;
  };
  return tasks.map((t) => visit(t.id));
}

/** Ranked positional weight: own time plus the time of every task that follows it. */
export function positionalWeights(tasks) {
  const succ = successorSets(tasks);
  return tasks.map((t) => t.time + [...succ[t.id]].reduce((s, j) => s + tasks[j].time, 0));
}

/** Column (longest path from a start task) for drawing the precedence diagram. */
export function layers(tasks) {
  const depth = [];
  for (const t of tasks) depth[t.id] = t.preds.length ? 1 + Math.max(...t.preds.map((p) => depth[p])) : 0;
  return depth;
}

/**
 * Live metrics for a (possibly partial) assignment.
 * @param {object} inst
 * @param {(number|null)[]} assignment  station index per task
 * @param {number} stationCount         stations currently open on the board
 */
export function evaluate(inst, assignment, stationCount) {
  const { tasks, takt, totalTime } = inst;
  const k = Math.max(stationCount, ...assignment.map((s) => (s == null ? 0 : s + 1)));
  const loads = new Array(k).fill(0);
  const members = Array.from({ length: k }, () => []);
  tasks.forEach((t) => {
    const s = assignment[t.id];
    if (s != null) {
      loads[s] += t.time;
      members[s].push(t.id);
    }
  });
  const violations = [];
  tasks.forEach((t) => {
    const s = assignment[t.id];
    if (s == null) return;
    t.preds.forEach((p) => {
      const ps = assignment[p];
      if (ps != null && ps > s) violations.push({ from: p, to: t.id });
    });
  });
  const unassigned = tasks.filter((t) => assignment[t.id] == null).map((t) => t.id);
  const overloaded = loads.map((l, i) => (l > takt ? i : -1)).filter((i) => i >= 0);
  const used = loads.filter((l) => l > 0).length;
  const cycleTime = Math.max(0, ...loads);
  const bottleneck = cycleTime > 0 ? loads.indexOf(cycleTime) : -1;
  const assignedTime = loads.reduce((a, b) => a + b, 0);
  const efficiency = used ? assignedTime / (used * takt) : 0;
  const complete = unassigned.length === 0;
  return {
    loads,
    members,
    stationsUsed: used,
    cycleTime,
    bottleneck,
    idlePerUnit: used * takt - assignedTime,
    efficiency,
    balanceDelay: used ? 1 - efficiency : 0,
    violations,
    overloaded,
    unassigned,
    complete,
    feasible: complete && violations.length === 0 && overloaded.length === 0,
    totalTime,
  };
}

/** A task is ready when all of its predecessors already have a station. */
export function readyTasks(inst, assignment) {
  return inst.tasks.filter((t) => assignment[t.id] == null && t.preds.every((p) => assignment[p] != null)).map((t) => t.id);
}

/**
 * Station-by-station heuristic: fill the current station with the highest
 * priority task that is ready and still fits, then open the next station.
 * This is how both the largest-candidate rule and the ranked positional
 * weight method work; they differ only in the priority order.
 */
export function balanceByPriority(inst, priority) {
  const { tasks, takt } = inst;
  const order = tasks.map((t) => t.id).sort((a, b) => priority[b] - priority[a] || a - b);
  const assignment = new Array(tasks.length).fill(null);
  let station = 0;
  let load = 0;
  let placed = 0;
  while (placed < tasks.length) {
    const pick = order.find((i) => assignment[i] == null && tasks[i].preds.every((p) => assignment[p] != null) && load + tasks[i].time <= takt);
    if (pick === undefined) {
      station += 1;
      load = 0;
      continue;
    }
    assignment[pick] = station;
    load += tasks[pick].time;
    placed += 1;
  }
  return { assignment, stations: station + 1 };
}

/** Largest-candidate rule: longest task first. */
export function largestCandidate(inst) {
  return balanceByPriority(inst, inst.tasks.map((t) => t.time));
}

/** Ranked positional weight method (Helgeson and Birnie). */
export function rankedPositionalWeight(inst) {
  return balanceByPriority(inst, positionalWeights(inst.tasks));
}

/**
 * Exact minimum number of stations by dynamic programming over subsets of
 * tasks (fine up to about 20 tasks). State = set of tasks already placed; the
 * value is the lexicographically smallest (stations, load of the last
 * station), which dominates every other way of reaching the same set.
 */
export function optimalStations(inst) {
  const { tasks, takt } = inst;
  const n = tasks.length;
  if (n > 20) throw new Error("optimalStations: too many tasks");
  const full = (1 << n) - 1;
  const predMask = tasks.map((t) => t.preds.reduce((m, p) => m | (1 << p), 0));
  const W = takt + 1;
  const best = new Float64Array(1 << n).fill(Infinity);
  const parent = new Int8Array(1 << n).fill(-1);
  best[0] = 1 * W + 0;
  for (let S = 0; S <= full; S++) {
    const v = best[S];
    if (v === Infinity) continue;
    const k = Math.floor(v / W);
    const load = v - k * W;
    for (let j = 0; j < n; j++) {
      const bit = 1 << j;
      if (S & bit || (predMask[j] & S) !== predMask[j]) continue;
      const t = tasks[j].time;
      const nv = load + t <= takt ? k * W + load + t : (k + 1) * W + t;
      const T = S | bit;
      if (nv < best[T]) {
        best[T] = nv;
        parent[T] = j;
      }
    }
  }
  // Rebuild one optimal sequence, then pack it station by station.
  const seq = [];
  for (let S = full; S; S &= ~(1 << parent[S])) seq.unshift(parent[S]);
  const assignment = new Array(n).fill(null);
  let station = 0;
  let load = 0;
  for (const j of seq) {
    if (load + tasks[j].time > takt) {
      station += 1;
      load = 0;
    }
    assignment[j] = station;
    load += tasks[j].time;
  }
  return { assignment, stations: Math.floor(best[full] / W) };
}

/** Stars for a feasible player line: 3 = optimal, 2 = one extra station, 1 = feasible. */
export function starsFor(playerStations, optimal) {
  if (playerStations <= optimal) return 3;
  if (playerStations === optimal + 1) return 2;
  return 1;
}
