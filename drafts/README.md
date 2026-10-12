# Weekly drafts

Put the instructor's raw draft for each week here. Any format works: bullet notes, a Word document, a PDF of slides, or a rough outline.

Naming: `week-XX-<anything>.<ext>`, for example `week-02-history-notes.md` or `week-05-slides.pdf`.

Then ask the agent:

> Generate the Week 2 lecture notes from `drafts/week-02-history-notes.md`.

The agent follows `AGENTS.md`. It turns the draft into `chapters/week-02.qmd` using `templates/chapter-template.qmd`, adds new terms to `data/glossary.yml`, adds sources to `references.bib`, creates the Colab notebook in `notebooks/`, and renders the book to check it.

Drafts are source material only. They aren't published on the website.

## Optional hints you can include in a draft

```text
Story ideas:    <URL or topic>
Must-use terms: takt time, kanban, ...
Notebook idea:  <what students should compute or plot>
Activity:       <in-class exercise idea>
Readings:       <books or articles to cite>
Emphasis:       <what matters most this week>
```
