# IMSE 111 learning games

Short (10 to 20 minute) browser games that live inside the book. Each game is a
folder of static HTML, CSS, and JavaScript. There is no framework, no build
step, no dependencies, and no network calls, so a game works offline once the
page has loaded, on phones and laptops, and inside an iframe.

```text
games/
  package.json            "type": "module" so node can run the tests; no dependencies
  shared/
    shell.js              createGame(): intro, play, results, debrief, replay
    game.css              theme tokens (light + dark), buttons, cards, tables
    config.js             validateGameConfig(): checks a createGame() config
    dom.js                h() / svg() element helpers, fmt(), pct()
    rng.js                seeded random numbers (createRng, randomSeed)
    config.test.js  rng.test.js
  line-balancer/          Game 1 (Week 5): assembly line balancing
    index.html  main.js  style.css  logic.js  logic.test.js
  spot-the-shift/         Game 2 (Week 7): control charts and run rules
    index.html  main.js  style.css  logic.js  logic.test.js
  lift-lab/               Week 6: NIOSH lifting equation and the Lifting Index
  build-for-uptime/       Week 4: series and parallel reliability, redundancy
  order-chain/            Week 9: four-stage supply chain and the bullwhip effect
```

Quarto copies everything under `games/` to the site (`resources: games/**` in
`_quarto.yml`), so a game is published at
`https://harunpirim.github.io/imse111-book/games/<slug>/` with the rest of the book.

## Run and test locally

Games use ES modules, which browsers only load over `http://`, not from a
`file://` path. From the repository root:

```bash
node --test "games/**/*.test.js"   # unit tests for all pure logic (Node 22+)
quarto preview                     # whole book, games included
# or just the games:
python3 -m http.server 8000        # then open http://localhost:8000/games/line-balancer/
```

Useful URL parameters for any game:

| Parameter | Effect |
|:--|:--|
| `?level=2` | Preselect level 2 on the intro screen |
| `?level=2&seed=12345` | The next round uses this seed (same round for everyone) |
| `?level=2&seed=12345&autostart=1` | Skip the intro and start that round |
| `?theme=dark` / `?theme=light` | Force a theme (otherwise: book toggle when embedded, OS setting when standalone) |

## The shell API

`shared/shell.js` owns everything that is the same in every game, so a game
only has to build its play area and report a result.

```js
import { createGame } from "../shared/shell.js";

createGame({
  slug: "my-game",                     // folder name, also the localStorage key
  title: "My Game",
  tagline: "One line under the title.",
  objective: "do X, explain Y, and compare Z.",   // shown after "You will learn to"
  minutes: "10-15",
  levelNoun: "Level",                  // optional: "Round", "Scenario", ...
  chapter: { href: "../../chapters/week-05.html", label: "Week 5 · ..." },
  howToPlay: ["Short bullet (HTML allowed)", "..."],
  assumptions: ["One product on one serial line.", "..."],  // required, see below
  levels: [{ id: "1", name: "Warm-up", blurb: "6 tasks" }, ...],  // any extra fields are yours
  start(ctx) { /* build one round */ },
});
```

### Assumptions (required)

Every game is a simplified model, and students should know what was simplified
before they play. `assumptions` is an array of short strings (inline HTML
allowed, like `howToPlay`), one simplification each. The shell shows them:

- on the **intro screen**, after "How to play" and before the level picker, in an
  open, collapsible box headed "Assumptions" with the lead line "This game
  simplifies the real world. It assumes:";
- on the **results screen**, as a closed "Assumptions behind this result" box
  just above the chapter link, so students can connect the result to the model.

Keep each point to one or two short sentences. Export the list from `logic.js`
(as `ASSUMPTIONS`) and build any numbers in it from the model's constants, for
example `` `one ${SHIFT_SECONDS / 60}-minute shift` ``, so the text can't drift
from the code. Add a test that checks the text against the model. Both games do
this.

The shell runs `validateGameConfig()` from `shared/config.js` on start and
prints a console warning for anything missing, including an empty
`assumptions` list.

### The round context

`start(ctx)` is called every time a round begins. `ctx` gives you:

| Field | What it is |
|:--|:--|
| `ctx.level`, `ctx.levelIndex` | The chosen level object (with your extra fields) and its index |
| `ctx.seed`, `ctx.rng` | The round's seed and a seeded generator (`next`, `int`, `uniform`, `normal`, `pick`, `shuffle`, `chance`, `fork`) |
| `ctx.stage` | Empty element to render the play area into |
| `ctx.setStatus(...nodes)` | Fill the strip above the stage (scenario, givens) |
| `ctx.announce(text)` | Say something to screen readers (polite live region) |
| `ctx.onCleanup(fn)` | Run `fn` when the round ends or the player leaves (clear timers, key listeners) |
| `ctx.embedded` | `true` inside the book's iframe |
| `ctx.finish(result)` | End the round and show the results screen |

`result` (all fields optional except `headline`):

```js
ctx.finish({
  outcome: "win" | "ok" | "miss",      // color and icon of the verdict banner
  stars: 0..3,                         // best per level is remembered on the device
  headline: "Balanced with 4 stations, the best possible",
  summary: "One short paragraph (HTML allowed).",
  comparison: {                        // "you vs. benchmark" table; first column is the player
    caption: "...",
    columns: ["You", "Heuristic", "Optimal"],
    rows: [{ label: "Stations", values: ["5", "5", "4"] }],
  },
  figure: someElement,                 // e.g. a chart of your answer vs. the best one
  debrief: [{ title: "Takt time", body: "<p>HTML string</p>" or element }],
});
```

The results screen then adds the link back to `chapter`, buttons for the next
level, a new round, an exact replay (same seed), and the menu, plus the seed.

The shell also:

- follows the book's light or dark mode when embedded (it watches the parent
  page's `quarto-dark` class) and the OS setting when standalone;
- posts `{ type: "imse-game:resize", height }` to the parent page so the book's
  iframe grows and shrinks with the game (`lua/game.lua` listens for it);
- hides its own top bar inside the book, and opens the chapter link in the top
  window.

## Add a new game

1. **Write the spec** (template below) and agree on it with the instructor.
2. **Copy a folder**: `cp -r games/line-balancer games/<slug>` and rename.
   Keep `index.html` as is apart from the title and description.
3. **Put all rules in `logic.js`**: instance generation, scoring, benchmark or
   optimal solutions, rule checks. No DOM access there. Write
   `logic.test.js` with `node:test` and `node:assert/strict`, then run
   `node --test "games/**/*.test.js"`.
4. **List the assumptions** as `ASSUMPTIONS` in `logic.js` and pass them to
   `createGame({ assumptions })`. Build numbers from the model's constants and
   test the text against the model.
5. **Build the play area in `main.js`** with `h()` / `svg()` from `shared/dom.js`.
   Draw randomness only from `ctx.rng`, so rounds can be replayed by seed.
6. **Style in `style.css`** using the tokens from `shared/game.css`
   (`--accent`, `--surface`, `--good`, `--warn`, `--bad`, `--c1`...`--c8`).
   Never put a color in a game file directly, so dark mode keeps working.
7. **Check accessibility**: everything reachable by keyboard, a visible focus
   ring, an `aria-label` on every SVG chart, and color never the only signal
   (add a label, number, icon, or pattern). Try it at 375 px wide, and in dark mode.
8. **Publish in the book**: add a section to `games.qmd`, and embed the game in
   the most relevant chapter with a "Play" callout:

   ```markdown
   ::: {.callout-tip title="Play: My Game (10 to 15 min)" icon="false"}
   One or two sentences on what students will practice.

   {{< game my-game title="My Game" >}}
   :::
   ```

   Any new IE vocabulary in those pages goes in `data/glossary.yml`.
9. **Render** with `quarto render --to html`, open `_book/games/<slug>/` and the
   chapter, and play every level once.

## Per-game spec template

Copy this into the pull request or an issue before writing code.

```markdown
### <Game name> (`games/<slug>/`)

**Chapter:** Week NN, <title>. **Time:** 10 to 20 min. **Levels:** N.

**Learning objective.** After playing, students can ... (one sentence, a verb students can be checked on)

**Core loop.** What the player sees, what they decide, and how they act
(mouse, touch, and keyboard). One paragraph.

**Levels.** What changes from level to level (size, tightness, noise), and how
each round is generated from the seed.

**Assumptions (required).** Every simplification the model makes, one short
point each, as students will read them on the intro screen. Cover the system
(what is and isn't modeled), the data (known, random, distribution), the rules
of play, costs or scores, and the benchmark. Check each against the code before
merging.

**Scoring.** The player's metric(s), and how stars (0 to 3) are awarded.

**Benchmark.** What the player is compared with: the optimum, a classic
heuristic, a rule-following operator, a bound. How it is computed.

**Results and debrief.** The comparison table, one figure, and 2 to 4 debrief
sections with the formulas worked out using the round's numbers.

**Terms.** Glossary terms used (new ones need entries in data/glossary.yml).

**Tests.** The pure functions in logic.js and what each test checks.
```
