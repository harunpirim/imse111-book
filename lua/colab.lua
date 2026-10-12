-- {{< colab week01_ie_by_the_numbers.ipynb title="IE by the numbers" >}}
-- {{< colab https://colab.research.google.com/drive/... title="Shared notebook" >}}
-- {{< colab week01_ie_by_the_numbers.ipynb style="badge" >}}   (badge only, e.g. in tables)
--
-- File names resolve against `colab:` settings in _quarto.yml.

local BADGE = "https://colab.research.google.com/assets/colab-badge.svg"

local function str(x, default)
  if x == nil then
    return default
  end
  local s = pandoc.utils.stringify(x)
  if s == "" then
    return default
  end
  return s
end

local function settings(meta)
  local c = meta["colab"] or {}
  -- Quarto rewrites metadata values that match existing folders into paths
  -- relative to the current file (e.g. "../notebooks"); undo that here.
  local dir = str(c["notebooks-dir"], "notebooks")
  repeat
    local before = dir
    dir = dir:gsub("^%.%./", ""):gsub("^%./", "")
  until dir == before
  return {
    repo = str(c["github-repo"], "YOUR-GITHUB-USERNAME/imse111-book"),
    branch = str(c["branch"], "main"),
    dir = dir,
  }
end

return {
  ["colab"] = function(args, kwargs, meta, raw_args, context)
    local target = str(args[1], "")
    if target == "" then
      quarto.log.warning("colab shortcode needs a notebook file name or URL")
      return pandoc.Null()
    end
    local title = str(kwargs["title"], target)
    local s = settings(meta)

    local colab_url, github_url, download_url
    if target:match("^https?://") then
      colab_url = target
    else
      local path = s.repo .. "/blob/" .. s.branch .. "/" .. s.dir .. "/" .. target
      colab_url = "https://colab.research.google.com/github/" .. path
      github_url = "https://github.com/" .. path
      local offset = (quarto.project and quarto.project.offset) or "."
      download_url = offset .. "/" .. s.dir .. "/" .. target
    end

    if not quarto.doc.is_format("html") then
      local inl = pandoc.Inlines({ pandoc.Strong("Colab notebook:"), pandoc.Space(), pandoc.Link(title, colab_url) })
      if context == "inline" then
        return inl
      end
      return pandoc.Para(inl)
    end

    local badge = pandoc.Link({ pandoc.Image({ pandoc.Str("Open In Colab") }, BADGE) }, colab_url, "Open in Google Colab",
      pandoc.Attr("", { "colab-badge" }, { target = "_blank", rel = "noopener" }))

    if context == "inline" or str(kwargs["style"], "") == "badge" then
      return badge
    end

    local links = pandoc.Inlines({ badge })
    if github_url then
      links:extend({ pandoc.Space(), pandoc.Link("View on GitHub", github_url, "", pandoc.Attr("", {}, { target = "_blank" })) })
      links:extend({ pandoc.Space(), pandoc.Str("·"), pandoc.Space(),
        pandoc.Link("Download .ipynb", download_url, "", pandoc.Attr("", {}, { download = "" })) })
    end

    return pandoc.Div({
      pandoc.Div(pandoc.Plain({
        pandoc.RawInline("html", '<i class="bi bi-journal-code" aria-hidden="true"></i> '),
        pandoc.Span("Hands-on notebook", pandoc.Attr("", { "box-label" })),
      }), pandoc.Attr("", { "colab-header" })),
      pandoc.Div(pandoc.Plain(pandoc.Inlines(title)), pandoc.Attr("", { "box-title" })),
      pandoc.Para(links),
    }, pandoc.Attr("", { "colab-card" }))
  end,
}
