-- Highlights industrial engineering terms and builds glossary listings.
--
--   [Takt time]{.term}                    highlighted term with hover definition
--   [takt times]{.term key="takt-time"}   same, with an explicit glossary key
--   ::: keyterms                          "Key terms" box listing every term
--   :::                                   used anywhere in the chapter
--   ::: glossary-list                     the full A-Z glossary (glossary.qmd)
--   :::

local data = dofile(quarto.utils.resolve_path("glossary-data.lua"))

local is_html = quarto.doc.is_format("html")
local used, seen = {}, {}

local function anchor(key)
  return "term-" .. key
end

local function glossary_href(key)
  if is_html then
    local offset = (quarto.project and quarto.project.offset) or "."
    return offset .. "/glossary.html#" .. anchor(key)
  end
  return "#" .. anchor(key)
end

local function render_term(span)
  if not span.classes:includes("term") then
    return nil
  end
  local text = pandoc.utils.stringify(span.content)
  local entry, key = data.lookup(text, span.attributes["key"])

  if not entry then
    quarto.log.warning("Term not in data/glossary.yml: '" .. text .. "' (looked for key '" .. key .. "')")
    return pandoc.Span(span.content, pandoc.Attr("", { "ie-term", "ie-term-missing" }))
  end

  if not seen[key] then
    seen[key] = true
    table.insert(used, key)
  end

  if is_html then
    return pandoc.Link(span.content, glossary_href(key), entry.definition, pandoc.Attr("", { "ie-term" }, {
      ["data-term"] = entry.term,
      ["data-def"] = entry.definition,
      ["data-category"] = entry.category,
    }))
  end
  return pandoc.Strong(span.content)
end

local function definition_item(key)
  local e = data.load()[key]
  local inl = pandoc.Inlines({ pandoc.Link({ pandoc.Strong(e.term) }, glossary_href(key)) })
  inl:insert(pandoc.Str(" — "))
  inl:extend(pandoc.Inlines(e.definition))
  return { pandoc.Plain(inl) }
end

local function keyterms_box(el)
  local keys = data.sorted_keys(used)
  if #keys == 0 then
    return pandoc.Div({})
  end
  local items = {}
  for _, k in ipairs(keys) do
    table.insert(items, definition_item(k))
  end
  return quarto.Callout({
    type = "note",
    title = el.attributes["title"] or "Key terms in this chapter",
    icon = false,
    collapse = el.attributes["collapse"] == "true",
    content = { pandoc.BulletList(items) },
  })
end

local function glossary_list()
  local g = data.load()
  local blocks = pandoc.Blocks({})
  local current = nil
  for _, k in ipairs(data.all_keys()) do
    local e = g[k]
    local letter = pandoc.text.upper(pandoc.text.sub(e.term, 1, 1))
    if letter:match("%d") then
      letter = "0–9"
    end
    if letter ~= current then
      current = letter
      blocks:insert(pandoc.Header(2, letter, pandoc.Attr("glossary-" .. data.slugify(letter), { "unnumbered" })))
    end
    local head = pandoc.Inlines({ pandoc.Strong(e.term) })
    if is_html then
      head:insert(pandoc.Space())
      head:insert(pandoc.Span(e.category, pandoc.Attr("", { "glossary-category" })))
    else
      head:insert(pandoc.Str(" (" .. e.category .. ")"))
    end
    blocks:insert(pandoc.Div({ pandoc.Para(head), pandoc.Para(pandoc.Inlines(e.definition)) },
      pandoc.Attr(anchor(k), { "glossary-entry" })))
  end
  return blocks
end

local function is_div(el, class)
  return el.t == "Div" and el.classes:includes(class)
end

local walker = { Span = render_term }

-- Chapters are delimited by level-1 headers so that combined outputs
-- (docx/pdf books) get one key-terms box per chapter.
return {
  {
    Pandoc = function(doc)
      local out = pandoc.Blocks({})
      local chapters = { { used = {}, seen = {} } }
      local placeholders = {}

      for _, block in ipairs(doc.blocks) do
        if block.t == "Header" and block.level == 1 and #out > 0 then
          table.insert(chapters, { used = {}, seen = {} })
        end
        local ch = chapters[#chapters]
        used, seen = ch.used, ch.seen
        if is_div(block, "keyterms") then
          out:insert(block)
          table.insert(placeholders, { index = #out, chapter = ch, div = block })
        elseif is_div(block, "glossary-list") then
          out:extend(glossary_list())
        else
          out:insert(block:walk(walker))
        end
      end

      for _, p in ipairs(placeholders) do
        used, seen = p.chapter.used, p.chapter.seen
        out[p.index] = (keyterms_box(p.div))
      end
      doc.blocks = out
      return doc
    end,
  },
}
