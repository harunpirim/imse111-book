import test from "node:test";
import assert from "node:assert/strict";
import { createRng, hashSeed } from "./rng.js";

test("same seed, same sequence", () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
});

test("string seeds hash consistently and differ", () => {
  assert.equal(hashSeed("level-1"), hashSeed("level-1"));
  assert.notEqual(hashSeed("level-1"), hashSeed("level-2"));
});

test("int stays in range and hits both ends", () => {
  const r = createRng(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const x = r.int(1, 6);
    assert.ok(x >= 1 && x <= 6 && Number.isInteger(x));
    seen.add(x);
  }
  assert.equal(seen.size, 6);
});

test("normal draws have roughly the right mean and sd", () => {
  const r = createRng("normal");
  const xs = Array.from({ length: 20000 }, () => r.normal(10, 2));
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  assert.ok(Math.abs(mean - 10) < 0.06, `mean ${mean}`);
  assert.ok(Math.abs(sd - 2) < 0.06, `sd ${sd}`);
});

test("fork gives independent but reproducible streams", () => {
  const a = createRng(1).fork("x");
  const b = createRng(1).fork("x");
  const c = createRng(1).fork("y");
  const va = a.next();
  assert.equal(va, b.next());
  assert.notEqual(va, c.next());
});

test("shuffle keeps every element", () => {
  const r = createRng(3);
  const arr = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(r.shuffle(arr).sort(), arr);
});
