// Game shell for IMSE 111 learning games.
//
// The shell owns everything that is the same in every game:
//   intro screen  -> title, learning objective, how to play, level picker
//   play screen   -> header with level name + quit button, an empty "stage"
//   results       -> headline, comparison table (you vs. benchmark), optional
//                    figure, debrief sections, link to the book chapter,
//                    replay / next level / menu buttons
// plus seeded randomness, best-score memory, light/dark theme sync with the
// book, and iframe auto-resizing. A game only fills the stage and calls
// ctx.finish(result). See games/README.md for the full contract.

import { h, replace } from "./dom.js";
import { createRng, randomSeed } from "./rng.js";

const STORE_PREFIX = "imse111-games:";

function readStore(slug) {
  try {
    return JSON.parse(localStorage.getItem(STORE_PREFIX + slug)) || {};
  } catch {
    return {};
  }
}

function writeStore(slug, data) {
  try {
    localStorage.setItem(STORE_PREFIX + slug, JSON.stringify(data));
  } catch {
    /* storage blocked: progress just isn't remembered */
  }
}

const embedded = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

// ---- Theme: follow the book's light/dark toggle when embedded -------------
function syncTheme() {
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const forced = params.get("theme");
  if (forced === "dark" || forced === "light") {
    root.dataset.theme = forced;
    return;
  }
  if (!embedded) return; // standalone page: CSS follows the OS setting
  try {
    const body = window.parent.document.body;
    const update = () => {
      if (body.classList.contains("quarto-dark")) root.dataset.theme = "dark";
      else if (body.classList.contains("quarto-light")) root.dataset.theme = "light";
      else delete root.dataset.theme;
    };
    update();
    new MutationObserver(update).observe(body, { attributes: true, attributeFilter: ["class"] });
  } catch {
    /* cross-origin parent: fall back to prefers-color-scheme */
  }
}

// ---- Iframe auto-height: the book page listens for these messages ----------
function reportHeight(slug, root) {
  if (!embedded || !window.parent) return;
  let last = 0;
  const send = () => {
    // Measure the game itself, not the iframe viewport, so the frame can shrink too.
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (Math.abs(height - last) < 2) return;
    last = height;
    window.parent.postMessage({ type: "imse-game:resize", slug, height }, "*");
  };
  new ResizeObserver(send).observe(root);
  window.addEventListener("load", send);
  send();
}

function stars(n, max = 3, label = true) {
  const filled = "★".repeat(n) + "☆".repeat(Math.max(0, max - n));
  return h("span", { class: "g-stars", "aria-label": label ? `${n} of ${max} stars` : null, role: label ? "img" : null }, filled);
}

/**
 * Create a game.
 * @param {object} cfg
 * @param {string} cfg.slug       folder name under games/, also the storage key
 * @param {string} cfg.title
 * @param {string} cfg.tagline    one line under the title
 * @param {string} cfg.objective  learning objective ("You will ...")
 * @param {string} [cfg.minutes]  e.g. "10-15"
 * @param {string[]} cfg.howToPlay  short bullet points (plain text or HTML)
 * @param {{href:string,label:string}} cfg.chapter  link back to the book
 * @param {{id:string,name:string,blurb?:string}[]} cfg.levels
 * @param {(ctx:object)=>void} cfg.start  builds one round inside ctx.stage
 * @param {string} [cfg.levelNoun]  "Level" (default), "Round", "Scenario", ...
 */
export function createGame(cfg) {
  const root = document.getElementById("app") || document.body.appendChild(h("div", { id: "app" }));
  root.classList.add("g-app");
  const Noun = cfg.levelNoun || "Level";
  const noun = Noun.toLowerCase();
  if (embedded) document.documentElement.classList.add("g-embedded");
  syncTheme();
  reportHeight(cfg.slug, root);

  const params = new URLSearchParams(location.search);
  const store = readStore(cfg.slug);
  store.best = store.best || {};
  let forcedSeed = params.has("seed") ? Number(params.get("seed")) || params.get("seed") : null;
  let selected = Math.max(0, cfg.levels.findIndex((l) => l.id === params.get("level")));
  let cleanups = [];

  const live = h("div", { class: "g-sr-only", "aria-live": "polite", role: "status" });
  const screen = h("main", { class: "g-screen" });
  const bookHref = cfg.bookHref || "../../games.html";
  const topbar = h(
    "header",
    { class: "g-topbar" },
    h("a", { class: "g-brand", href: bookHref, target: embedded ? "_top" : null }, "IMSE 111 · Learning games"),
    h("span", { class: "g-topbar-title" }, cfg.title),
  );
  replace(root, topbar, screen, live);

  function announce(text) {
    live.textContent = "";
    setTimeout(() => (live.textContent = text), 30);
  }

  function runCleanups() {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
    cleanups = [];
  }

  function focusHeading() {
    const heading = screen.querySelector("h1, h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: embedded });
    }
    if (!embedded) window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- intro
  function showIntro() {
    runCleanups();
    screen.dataset.view = "intro";
    const levelButtons = cfg.levels.map((lvl, i) =>
      h(
        "button",
        {
          type: "button",
          class: "g-level",
          role: "radio",
          "aria-checked": String(i === selected),
          tabindex: i === selected ? "0" : "-1",
          onclick: () => {
            selected = i;
            showIntro();
            screen.querySelector(".g-level[aria-checked=true]")?.focus();
          },
          onkeydown: (e) => {
            const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
            if (!d) return;
            e.preventDefault();
            selected = (i + d + cfg.levels.length) % cfg.levels.length;
            showIntro();
            screen.querySelector(".g-level[aria-checked=true]")?.focus();
          },
        },
        h("span", { class: "g-level-num" }, `${Noun} ${i + 1}`),
        h("span", { class: "g-level-name" }, lvl.name),
        lvl.blurb ? h("span", { class: "g-level-blurb" }, lvl.blurb) : null,
        h("span", { class: "g-level-best" }, store.best[lvl.id] != null ? stars(store.best[lvl.id]) : "Not played"),
      ),
    );

    replace(
      screen,
      h(
        "section",
        { class: "g-intro" },
        h("h1", { class: "g-title" }, cfg.title),
        h("p", { class: "g-tagline" }, cfg.tagline),
        h(
          "div",
          { class: "g-objective" },
          h("strong", {}, "You will learn to "),
          cfg.objective,
          cfg.minutes ? h("span", { class: "g-time" }, ` · about ${cfg.minutes} min`) : null,
        ),
        h("h2", { class: "g-h2" }, "How to play"),
        h("ul", { class: "g-howto" }, cfg.howToPlay.map((t) => h("li", { html: t }))),
        h("h2", { class: "g-h2", id: "g-levels-label" }, `Choose a ${noun}`),
        h("div", { class: "g-levels", role: "radiogroup", "aria-labelledby": "g-levels-label" }, levelButtons),
        h(
          "div",
          { class: "g-actions" },
          h("button", { type: "button", class: "g-btn g-btn-primary g-btn-lg", onclick: () => play(selected) }, `Start ${noun} ${selected + 1}`),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- play
  function play(index, seed) {
    runCleanups();
    selected = index;
    const level = cfg.levels[index];
    const useSeed = seed ?? forcedSeed ?? randomSeed();
    forcedSeed = null;
    const rng = createRng(`${cfg.slug}:${level.id}:${useSeed}`);
    screen.dataset.view = "play";

    const status = h("div", { class: "g-status", "aria-live": "off" });
    const stage = h("div", { class: "g-stage" });
    replace(
      screen,
      h(
        "div",
        { class: "g-playbar" },
        h("h1", { class: "g-playtitle" }, `${Noun} ${index + 1}: ${level.name}`),
        h("button", { type: "button", class: "g-btn g-btn-ghost", onclick: showIntro }, "Menu"),
      ),
      status,
      stage,
    );
    focusHeading();

    let done = false;
    const ctx = {
      level,
      levelIndex: index,
      seed: useSeed,
      rng,
      stage,
      embedded,
      announce,
      setStatus: (...nodes) => replace(status, ...nodes),
      onCleanup: (fn) => cleanups.push(fn),
      finish(result) {
        if (done) return;
        done = true;
        showResults(index, useSeed, result);
      },
    };
    cfg.start(ctx);
  }

  // ---------------------------------------------------------------- results
  function showResults(index, seed, r) {
    runCleanups();
    const level = cfg.levels[index];
    screen.dataset.view = "results";
    if (typeof r.stars === "number") {
      const prev = store.best[level.id];
      if (prev == null || r.stars > prev) store.best[level.id] = r.stars;
      writeStore(cfg.slug, store);
    }

    const table = r.comparison
      ? h(
          "div",
          { class: "g-table-wrap" },
          h(
            "table",
            { class: "g-table" },
            r.comparison.caption ? h("caption", {}, r.comparison.caption) : null,
            h("thead", {}, h("tr", {}, h("th", { scope: "col" }, ""), r.comparison.columns.map((c, i) => h("th", { scope: "col", class: i === 0 ? "g-you" : null }, c)))),
            h(
              "tbody",
              {},
              r.comparison.rows.map((row) =>
                h("tr", {}, h("th", { scope: "row" }, row.label), row.values.map((v, i) => h("td", { class: i === 0 ? "g-you" : null }, v))),
              ),
            ),
          ),
        )
      : null;

    const next = index + 1 < cfg.levels.length ? index + 1 : null;
    const chapterLink = cfg.chapter
      ? h("p", { class: "g-chapter" }, "Read more: ", h("a", { href: cfg.chapter.href, target: embedded ? "_top" : null }, cfg.chapter.label))
      : null;

    replace(
      screen,
      h(
        "section",
        { class: "g-results" },
        h(
          "div",
          { class: `g-verdict g-verdict-${r.outcome || "ok"}` },
          h("span", { class: "g-verdict-icon", "aria-hidden": "true" }, { win: "✔", ok: "◆", miss: "✖" }[r.outcome || "ok"]),
          h("div", {}, h("h1", { class: "g-verdict-title" }, r.headline), typeof r.stars === "number" ? stars(r.stars) : null),
        ),
        r.summary ? h("p", { class: "g-summary", html: r.summary }) : null,
        table,
        r.figure || null,
        (r.debrief || []).map((d) =>
          h("section", { class: "g-debrief" }, h("h2", { class: "g-h2" }, d.title), typeof d.body === "string" ? h("div", { html: d.body }) : d.body),
        ),
        chapterLink,
        h(
          "div",
          { class: "g-actions" },
          next !== null ? h("button", { type: "button", class: "g-btn g-btn-primary", onclick: () => play(next) }, `Next: ${noun} ${next + 1}`) : null,
          h("button", { type: "button", class: "g-btn", onclick: () => play(index) }, `New round, same ${noun}`),
          h("button", { type: "button", class: "g-btn", onclick: () => play(index, seed) }, "Replay this exact round"),
          h("button", { type: "button", class: "g-btn g-btn-ghost", onclick: showIntro }, "Menu"),
        ),
        h("p", { class: "g-seed" }, `${Noun} ${index + 1} · seed ${seed}. Add ?level=${level.id}&seed=${seed} to the game's URL to share this exact round.`),
      ),
    );
    focusHeading();
    announce(r.headline);
  }

  if (params.has("level") && params.get("autostart") === "1") play(selected);
  else showIntro();

  return { showIntro, play };
}
