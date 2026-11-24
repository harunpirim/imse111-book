// Tiny DOM helpers shared by the games. No framework, no build step.
//
//   h("button", { class: "btn", onclick: go }, "Start")
//   svg("circle", { cx: 10, cy: 10, r: 4 })
//
// Attributes starting with "on" become event listeners. `class`, `style`
// (string), `dataset` (object), and boolean attributes are handled. Children
// can be strings, numbers, nodes, arrays, or null/false (skipped).

const SVG_NS = "http://www.w3.org/2000/svg";

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "dataset") {
      Object.assign(el.dataset, v);
    } else if (k === "html") {
      el.innerHTML = v;
    } else if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Create an HTML element. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

/** Create an SVG element. */
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

/** Remove all children of an element and append new ones. */
export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** Format a number with a fixed number of decimals, dropping "-0". */
export function fmt(x, digits = 0) {
  const s = Number(x).toFixed(digits);
  return s === (-0).toFixed(digits) ? (0).toFixed(digits) : s;
}

/** Format a fraction (0.873) as a percentage ("87.3%"). */
export function pct(x, digits = 1) {
  return `${fmt(100 * x, digits)}%`;
}
