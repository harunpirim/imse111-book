// Checks a createGame() config. Pure, so it runs under node --test.
// The shell prints each problem with console.warn; tests can assert none.

const REQUIRED_STRINGS = ["slug", "title", "tagline", "objective"];
const LIST_FIELDS = ["howToPlay", "assumptions"]; // required, non-empty arrays of short strings

/** Return a list of human-readable problems with a game config (empty = fine). */
export function validateGameConfig(cfg) {
  const problems = [];
  if (!cfg || typeof cfg !== "object") return ["config must be an object"];
  for (const k of REQUIRED_STRINGS) {
    if (typeof cfg[k] !== "string" || !cfg[k].trim()) problems.push(`"${k}" must be a non-empty string`);
  }
  if (typeof cfg.slug === "string" && !/^[a-z0-9-]+$/.test(cfg.slug)) problems.push(`"slug" must be lowercase letters, digits, and hyphens`);
  for (const k of LIST_FIELDS) {
    const v = cfg[k];
    if (!Array.isArray(v) || v.length === 0) {
      problems.push(`"${k}" must be a non-empty array of strings`);
      continue;
    }
    v.forEach((item, i) => {
      if (typeof item !== "string" || !item.trim()) problems.push(`"${k}[${i}]" must be a non-empty string`);
    });
  }
  if (!Array.isArray(cfg.levels) || cfg.levels.length === 0) problems.push(`"levels" must be a non-empty array`);
  else {
    const ids = new Set();
    cfg.levels.forEach((l, i) => {
      if (!l || typeof l.id !== "string" || !l.id) problems.push(`"levels[${i}].id" must be a non-empty string`);
      else if (ids.has(l.id)) problems.push(`"levels[${i}].id" "${l.id}" is used twice`);
      else ids.add(l.id);
      if (!l || typeof l.name !== "string" || !l.name) problems.push(`"levels[${i}].name" must be a non-empty string`);
    });
  }
  if (typeof cfg.start !== "function") problems.push(`"start" must be a function`);
  return problems;
}
