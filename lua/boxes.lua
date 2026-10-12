-- Styled boxes for narrative content.
--
--   ::: {.story title="..." source="https://..." source-title="Publisher"}
--   ::: {.activity title="..."}
--   ::: {.career title="..." source="https://..."}
--
-- `source` is optional; `label` overrides the small caption above the title.

local kinds = {
  story = { label = "Story from the field", icon = "bi-newspaper" },
  activity = { label = "In-class activity", icon = "bi-people" },
  career = { label = "Career spotlight", icon = "bi-briefcase" },
}

local is_html = quarto.doc.is_format("html")

local function md_inlines(s)
  local doc = pandoc.read(s, "markdown")
  if #doc.blocks > 0 and doc.blocks[1].content then
    return doc.blocks[1].content
  end
  return pandoc.Inlines(s)
end

local function source_para(el)
  local url = el.attributes["source"]
  if not url or url == "" then
    return nil
  end
  local name = el.attributes["source-title"]
  if not name or name == "" then
    name = url
  end
  return pandoc.Para({ pandoc.Str("Source:"), pandoc.Space(), pandoc.Link(md_inlines(name), url) })
end

function Div(el)
  local kind, spec
  for k, v in pairs(kinds) do
    if el.classes:includes(k) then
      kind, spec = k, v
      break
    end
  end
  if not kind then
    return nil
  end

  local label = el.attributes["label"] or spec.label
  local title = el.attributes["title"]
  local src = source_para(el)

  if is_html then
    local header = pandoc.Blocks({
      pandoc.Plain({
        pandoc.RawInline("html", '<i class="bi ' .. spec.icon .. '" aria-hidden="true"></i> '),
        pandoc.Span(label, pandoc.Attr("", { "box-label" })),
      }),
    })
    if title then
      header:insert(pandoc.Div(pandoc.Plain(md_inlines(title)), pandoc.Attr("", { "box-title" })))
    end
    local blocks = pandoc.Blocks({
      pandoc.Div(header, pandoc.Attr("", { "box-header" })),
      pandoc.Div(el.content, pandoc.Attr("", { "box-body" })),
    })
    if src then
      blocks:insert(pandoc.Div(src, pandoc.Attr("", { "box-source" })))
    end
    return pandoc.Div(blocks, pandoc.Attr(el.identifier, { "ie-box", "ie-box-" .. kind }))
  end

  local head = pandoc.Inlines({ pandoc.Str(label) })
  if title then
    head:insert(pandoc.Str(":"))
    head:insert(pandoc.Space())
    head:extend(md_inlines(title))
  end
  local blocks = pandoc.Blocks({ pandoc.Para({ pandoc.Strong(head) }) })
  blocks:extend(el.content)
  if src then
    blocks:insert(src)
  end
  return pandoc.BlockQuote(blocks)
end
