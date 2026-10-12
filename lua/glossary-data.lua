-- Loads data/glossary.yml once and provides term lookup helpers.

local M = {}
local cache = nil

local function slugify(s)
  s = pandoc.text.lower(s)
  s = s:gsub("’", ""):gsub("'", "")
  s = s:gsub("[^%w]+", "-")
  s = s:gsub("^%-+", ""):gsub("%-+$", "")
  return s
end
M.slugify = slugify

local function glossary_path()
  local root = (quarto.project and quarto.project.directory) or "."
  return pandoc.path.join({ root, "data", "glossary.yml" })
end

function M.load()
  if cache then
    return cache
  end
  cache = {}
  local path = glossary_path()
  local f = io.open(path, "r")
  if not f then
    quarto.log.warning("Glossary file not found: " .. path)
    return cache
  end
  local text = f:read("a")
  f:close()

  local meta = pandoc.read("---\n" .. text .. "\n---\n", "markdown").meta
  for key, entry in pairs(meta) do
    if type(entry) == "table" and entry.term then
      cache[key] = {
        key = key,
        term = pandoc.utils.stringify(entry.term),
        definition = pandoc.utils.stringify(entry.definition or ""),
        category = pandoc.utils.stringify(entry.category or "General"),
      }
    end
  end
  return cache
end

-- Returns (entry, key). entry is nil when the term is not in the glossary.
function M.lookup(text, key)
  local g = M.load()
  if key and key ~= "" then
    return g[key], key
  end
  local slug = slugify(text)
  if g[slug] then
    return g[slug], slug
  end
  for _, suffix in ipairs({ "es", "s" }) do
    if #slug > #suffix and slug:sub(-#suffix) == suffix then
      local base = slug:sub(1, -#suffix - 1)
      if g[base] then
        return g[base], base
      end
    end
  end
  for k, e in pairs(g) do
    if slugify(e.term) == slug then
      return e, k
    end
  end
  return nil, slug
end

function M.sorted_keys(keys)
  local g = M.load()
  local list = {}
  for _, k in ipairs(keys) do
    if g[k] then
      table.insert(list, k)
    end
  end
  table.sort(list, function(a, b)
    return pandoc.text.lower(g[a].term) < pandoc.text.lower(g[b].term)
  end)
  return list
end

function M.all_keys()
  local keys = {}
  for k, _ in pairs(M.load()) do
    table.insert(keys, k)
  end
  return M.sorted_keys(keys)
end

return M
