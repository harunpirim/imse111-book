import test from "node:test";
import assert from "node:assert/strict";
import { validateGameConfig } from "./config.js";
import { ASSUMPTIONS as LB_ASSUMPTIONS, LEVELS as LB_LEVELS } from "../line-balancer/logic.js";
import { ASSUMPTIONS as SS_ASSUMPTIONS, ROUNDS as SS_ROUNDS } from "../spot-the-shift/logic.js";

const base = {
  slug: "demo-game",
  title: "Demo",
  tagline: "A tagline.",
  objective: "do something.",
  howToPlay: ["Click things."],
  assumptions: ["Everything is simple."],
  levels: [{ id: "1", name: "One" }],
  start() {},
};

test("a complete config has no problems", () => {
  assert.deepEqual(validateGameConfig(base), []);
});

test("assumptions are required and must be non-empty strings", () => {
  const { assumptions, ...noAssumptions } = base;
  void assumptions;
  assert.ok(validateGameConfig(noAssumptions).some((p) => p.includes('"assumptions"')));
  assert.ok(validateGameConfig({ ...base, assumptions: [] }).some((p) => p.includes('"assumptions"')));
  assert.ok(validateGameConfig({ ...base, assumptions: ["ok", ""] }).some((p) => p.includes('"assumptions[1]"')));
});

test("other required fields, slug format, and duplicate level ids are caught", () => {
  assert.ok(validateGameConfig({ ...base, title: "" }).some((p) => p.includes('"title"')));
  assert.ok(validateGameConfig({ ...base, slug: "Bad Slug" }).some((p) => p.includes('"slug"')));
  assert.ok(validateGameConfig({ ...base, levels: [{ id: "1", name: "A" }, { id: "1", name: "B" }] }).some((p) => p.includes("used twice")));
  assert.ok(validateGameConfig({ ...base, start: null }).some((p) => p.includes('"start"')));
});

test("both games' assumptions and levels pass validation", () => {
  assert.deepEqual(validateGameConfig({ ...base, assumptions: LB_ASSUMPTIONS, levels: LB_LEVELS }), []);
  assert.deepEqual(validateGameConfig({ ...base, assumptions: SS_ASSUMPTIONS, levels: SS_ROUNDS }), []);
});
