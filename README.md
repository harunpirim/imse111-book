# IMSE 111 Lecture Notes · Introduction to Industrial & Manufacturing Engineering

A [Quarto](https://quarto.org) book of weekly lecture notes for IMSE 111 at North Dakota State University. The same source produces:

- a **website** (searchable, mobile-friendly, dark mode) for students, and
- a **Word manuscript** (`_book/imse111-lecture-notes.docx`) for the book proposal.

## Quick start

1. Install [Quarto](https://quarto.org/docs/get-started/) (version 1.6 or newer).
2. Preview with live reload:

   ```bash
   quarto preview
   ```

3. Build everything (website and Word file) into `_book/`:

   ```bash
   quarto render
   ```

Python isn't needed to build the book. Code runs in the Colab notebooks.

## Project layout

```text
_quarto.yml              Book settings: chapters, theme, Colab repo, formats
index.qmd                Welcome page + course schedule (update status pills here)
how-to-use.qmd           Student tour of the book's features
chapters/week-XX.qmd     One chapter per week (week-01 is a full sample)
notebooks/               Colab notebooks (_template.ipynb + one per week)
data/glossary.yml        IE terms: the single source for highlights and the glossary
references.bib, apa.csl  Bibliography (APA 7)
images/                  Cover and per-week illustrations (images/weekXX/)
styles/                  NDSU-branded theme, dark mode, term hover cards
lua/                     Quarto filters/shortcodes powering the features below
templates/               chapter-template.qmd for new weeks
drafts/                  Instructor's raw weekly drafts (not published)
proposal/                Publisher book proposal (renders on its own)
AGENTS.md                Step-by-step instructions for draft → chapter conversion
```

## Authoring cheat sheet

| You write | You get |
|:--|:--|
| `[takt time]{.term}` | Highlighted term with a hover definition, linked to the glossary |
| `[bottlenecks]{.term key="bottleneck"}` | Same, with an explicit glossary key |
| `::: keyterms` / `:::` | Box listing every term used in the chapter |
| `::: {.story title="..." source="URL" source-title="..."}` | "Story from the field" box with a source link |
| `::: {.activity title="..."}` | "In-class activity" box |
| `::: {.career title="..." source="URL"}` | "Career spotlight" box |
| `{{< colab week01_ie_by_the_numbers.ipynb title="..." >}}` | Notebook card: Open in Colab, View on GitHub, Download |
| `{{< colab file.ipynb style="badge" >}}` | Just the Colab badge (for tables) |
| `[@taylor1911]` | APA citation, added to References automatically |
| ` ```{mermaid} ` | Process diagram / flowchart |

New terms go in `data/glossary.yml`. A term that isn't in the glossary shows a wavy red underline and a render warning.

## Weekly workflow

1. Drop your draft into `drafts/`, for example `drafts/week-02-notes.md`. Notes, Word, PDF, or slides all work.
2. Ask the agent: *"Generate the Week 2 lecture notes from `drafts/week-02-notes.md`."*
3. The agent follows [`AGENTS.md`](AGENTS.md). It writes `chapters/week-02.qmd`, adds glossary terms and references, finds sourced stories, builds the Colab notebook and banner illustration, and renders to check the result.
4. Review, edit, commit. The site redeploys automatically.

## Publishing

1. Create a GitHub repository (for example `imse111-book`) and push this folder.
2. In `_quarto.yml`, set `colab.github-repo: "your-username/imse111-book"`. Optionally uncomment `repo-url` and `repo-actions`.
3. Run `quarto publish gh-pages` once. After that, `.github/workflows/publish.yml` rebuilds the site on every push to `main`.
4. In the repository settings, under **Pages**, set the source to the `gh-pages` branch.

Colab opens notebooks straight from the public GitHub repository, so the Colab badges work once the repository is public.

## Book proposal

`proposal/book-proposal.qmd` holds the publisher proposal: overview, audience, features, competing titles, and table of contents. Render it with:

```bash
quarto render proposal/book-proposal.qmd --to docx
```

Send it with `_book/imse111-lecture-notes.docx`, or with individual sample chapters.
