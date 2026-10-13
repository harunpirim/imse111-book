# Agent instructions: turning a weekly draft into lecture notes

This repository is a Quarto book of IMSE 111 (Introduction to Industrial and Manufacturing Systems Engineering, NDSU) lecture notes. The notes will also become a textbook proposal. The instructor supplies one draft per week in `drafts/`. Your job is to turn that draft into a polished chapter.

## Inputs and outputs

| Input | Output |
|:--|:--|
| `drafts/week-XX-*` (md, docx, pdf, txt, ...) | `chapters/week-XX.qmd` (replace the stub) |
| Terms used in the draft | New entries in `data/glossary.yml` |
| Sources (draft + web research) | New entries in `references.bib` |
| Computational ideas | `notebooks/weekXX_<short_name>.ipynb` |
| Illustration idea | `images/weekXX/banner.jpg` (+ optional figures) |
| Status | Update the week's row in `index.qmd` (pill: Planned → Draft v1) and the table in `notebooks.qmd` |

## Steps

1. **Read the draft completely.** Keep the instructor's scope, emphasis, examples, and order. Don't drop content. If something seems wrong, keep it, flag it in your summary, and suggest a fix.
2. **Start from `templates/chapter-template.qmd`.** Keep its section order: banner → objectives → story → main sections with a worked example → Colab card → activity → key takeaways → check your understanding → `::: keyterms` → further reading. Keep the heading ID `{#sec-week-XX}`.
3. **Highlight IE terms.** Wrap the *first* use of each important term in a section with `[term]{.term}`. Use `key="slug"` when the display text differs, for example plurals or abbreviations. Add any missing term to `data/glossary.yml` with `term`, `category` (reuse an existing category), and a plain, one or two sentence `definition` with no colons followed by spaces. A rendered term with a wavy red underline means its glossary entry is missing.
4. **Stories from the web.** Find one or two real, reputable stories (news, museums, professional societies, company case studies, government data). Verify every fact against the page. Never invent quotes, numbers, or URLs. Put each story in a `.story` box with `source` and `source-title`, and cite it with a `@misc` entry in `references.bib` that includes `url` and `urldate`.
5. **References.** Every factual claim needs a citation `[@key]`. Prefer primary or authoritative sources. Keep `references.bib` grouped (books, articles, web).
6. **Colab notebook.** Copy `notebooks/_template.ipynb`. Keep it short, run top to bottom without errors, and use only libraries available in Colab by default (numpy, pandas, matplotlib, scipy). Include "Try it yourself" exercises. Run it locally before linking it with `{{< colab weekXX_name.ipynb title="..." >}}`.
7. **Illustrations.** Generate a 16:9 banner in the house style: flat vector, NDSU green `#0A5640` and gold `#FFC82E`, off-white background, diverse people, no text. Save it to `images/weekXX/banner.jpg`. Use Mermaid for process diagrams. Every image needs a caption and `fig-alt`.
8. **Voice.** Write for first-year engineering students. Use short paragraphs, active voice, "you", and concrete numbers. Define every symbol. Use `$...$` for math, not `\( \)`.
9. **Render and check.** Run `quarto render --to html`. Fix all warnings (missing terms, citations, cross-references). Open the chapter and check the term tooltips, story boxes, Colab links, and the key-terms box.
10. **Summarize** what you changed, what you researched (with links), and anything the instructor should review.

## Conventions

- File names: `chapters/week-XX.qmd`, `notebooks/weekXX_snake_case.ipynb`, `images/weekXX/`.
- Cross-references: `@sec-week-03`, `@fig-...`, `@tbl-...`.
- Colab URLs come from `colab:` in `_quarto.yml`. Don't hard-code GitHub URLs.
- Don't edit `lua/` or `styles/` unless the task is about the build or design.
