// Seeded randomness for IMSE 111 games.
//
// Every game that uses randomness should draw from one of these generators so
// a round can be replayed exactly from its seed (shown on the results screen
// and accepted as ?seed=... in the URL).
//
//   import { createRng, randomSeed } from "../shared/rng.js";
//   const rng = createRng(12345);
//   rng.next();          // uniform float in [0, 1)
//   rng.int(1, 6);       // integer in [1, 6], inclusive
//   rng.normal(0, 1);    // normal draw (Box-Muller)
//   rng.pick(array);     // one element
//   rng.shuffle(array);  // new shuffled copy
//   rng.fork("level-2"); // independent child stream, also reproducible

/** Hash any string or number into an unsigned 32-bit seed. */
export function hashSeed(value) {
  const s = String(value);
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A fresh seed for a new round (5-6 digits so students can read it aloud). */
export function randomSeed() {
  return 10000 + Math.floor(Math.random() * 990000);
}

/** Create a deterministic generator (mulberry32) from a number or string. */
export function createRng(seed) {
  const start = typeof seed === "number" && Number.isInteger(seed) ? seed >>> 0 : hashSeed(seed);
  let a = start;
  let spare = null;

  function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const rng = {
    seed: start,
    next,
    /** Uniform float in [min, max). */
    uniform(min = 0, max = 1) {
      return min + (max - min) * next();
    },
    /** Uniform integer in [min, max], both inclusive. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** True with probability p. */
    chance(p) {
      return next() < p;
    },
    /** Normal draw with the given mean and standard deviation. */
    normal(mean = 0, sd = 1) {
      if (spare !== null) {
        const z = spare;
        spare = null;
        return mean + sd * z;
      }
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return mean + sd * r * Math.cos(2 * Math.PI * v);
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** Independent, reproducible child generator keyed by a label. */
    fork(label) {
      return createRng(hashSeed(`${start}:${label}`));
    },
  };
  return rng;
}
