-- {{< game line-balancer title="Line Balancer" >}}
-- {{< game spot-the-shift title="Spot the Shift" height="900" >}}
--
-- Embeds the browser game in games/<slug>/ as an iframe that resizes itself to
-- fit the game (games/shared/shell.js posts its height), with links to open it
-- full screen and to the games index. Word and other non-HTML formats get a
-- plain link to the published game instead.

local DEFAULT_SITE = "https://harunpirim.github.io/imse111-book/"

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

local RESIZER = [[
<style>
.game-embed { margin: 0.75rem 0 0.25rem; }
.game-embed iframe { display: block; width: 100%; border: 1px solid var(--bs-border-color, #d5ddd9); border-radius: 10px; background: transparent; }
.game-embed-links { font-size: 0.85rem; margin-top: 0.35rem; }
</style>
<script>
window.addEventListener("message", function (e) {
  var d = e.data;
  if (!d || d.type !== "imse-game:resize" || typeof d.height !== "number") return;
  document.querySelectorAll("iframe.game-frame").forEach(function (f) {
    if (f.contentWindow === e.source) f.style.height = Math.max(320, Math.min(6000, Math.ceil(d.height) + 4)) + "px";
  });
});
</script>
]]

local included = false

return {
  ["game"] = function(args, kwargs, meta)
    local slug = str(args[1], "")
    if slug == "" or not slug:match("^[%w%-_]+$") then
      quarto.log.warning("game shortcode needs a game folder name, e.g. {{< game line-balancer >}}")
      return pandoc.Null()
    end
    local title = str(kwargs["title"], slug)
    local height = str(kwargs["height"], "720")

    if not quarto.doc.is_format("html") then
      local site = DEFAULT_SITE
      if meta["book"] and meta["book"]["site-url"] then
        site = str(meta["book"]["site-url"], DEFAULT_SITE)
      end
      if not site:match("/$") then
        site = site .. "/"
      end
      return pandoc.Para({ pandoc.Strong("Learning game:"), pandoc.Space(), pandoc.Link(title, site .. "games/" .. slug .. "/") })
    end

    if not included then
      quarto.doc.include_text("after-body", RESIZER)
      included = true
    end

    local offset = (quarto.project and quarto.project.offset) or "."
    local src = offset .. "/games/" .. slug .. "/index.html"
    local html = string.format(
      '<div class="game-embed"><iframe class="game-frame" src="%s" title="%s (interactive game)" loading="lazy" style="height:%spx" allow="fullscreen"></iframe>'
        .. '<div class="game-embed-links"><a href="%s" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> Open %s full screen</a> · <a href="%s/games.html">All learning games</a></div></div>',
      src, title, height, src, title, offset
    )
    return pandoc.RawBlock("html", html)
  end,
}
