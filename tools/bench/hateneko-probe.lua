-- Independent benchmark instrumentation; no runtime implementation is bundled here.
-- Copy as player/hnbench_probe.lua; require('hnbench_probe') FIRST in main.lua.
-- Inert unless HNBENCH_OUT is nonempty. OUT must be absolute and its parent must
-- exist. FRAMES defaults to 300, WARMUP to 60; WORK overrides STARTUP.work.
-- seed=1 is reapplied after love.load, NOT a claim of a shared RNG with NekoC.
-- frame_ms times rt.step only (fixed dt=1/60), not update/draw/present/vsync.
-- import_ms starts here and ends AFTER rt.start (includes resource preloading,
-- start_ms and probe setup, excludes earlier Lua startup and offline compilation).
-- conf.lua may already have required the work before this module can observe it.
-- Thus import_ms DOES NOT include that cached work parse in the stock player.
-- A runner copy may omit conf.lua's work-based window-sizing block (main.lua
-- still calls setMode); only then does this interval include work require/parse.
-- Native probe/shot modes are disabled: this module never synthesizes input.
local output = os.getenv('HNBENCH_OUT')
if not output or output == '' then return { enabled = false } end

local function now()
  if love and love.timer and love.timer.getTime then return love.timer.getTime() end
  return os.clock()
end
local began = now()
local original_require = require
local unpack = unpack or table.unpack
local function pack(...) return { n = select('#', ...), ... } end
local function returns(t) return unpack(t, 1, t.n) end
local shapes = setmetatable({}, { __mode = 'k' })
local function array(t) t = t or {}; shapes[t] = 'array'; return t end
local function object(t) t = t or {}; shapes[t] = 'object'; return t end
local NULL = {}
local rt, finished, pending, started = nil, false, false, false
local frame_count, frames, warmup = 0, 300, 60
local frame_ms, warmup_ms, errors = array(), array(), array()
local import_ms, start_ms, load_ms
local work_name = os.getenv('HNBENCH_WORK')
local initial_work = (work_name and work_name ~= '' and work_name)
  or (type(STARTUP) == 'table' and STARTUP.work) or 'media'
local work_cached_at_entry = package.loaded['works.' .. initial_work] ~= nil
local wrapped = setmetatable({}, { __mode = 'k' })

local function record(source, message, th)
  errors[#errors + 1] = object({ source = source, message = tostring(message),
    frame = frame_count, owner_id = th and th.owner and th.owner.id,
    hat = th and th.hat })
end

local function quote(s)
  return '"' .. s:gsub('[%z\1-\31\\"]', function(c)
    local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n',
      ['\r'] = '\\r', ['\t'] = '\\t', ['\b'] = '\\b', ['\f'] = '\\f' }
    return escapes[c] or string.format('\\u%04x', string.byte(c))
  end) .. '"'
end

-- rt.values uses ordinary tables: positive integer keys are list elements;
-- __ver/__set are list caches, not data. Empty declared lists need a scope hint.
-- Unmarked empty tables are objects. Lua nil is JSON null; any identity-based
-- null/undefined sentinel exposed by rt.values/rt.json is also recognized.
-- A runtime that already discarded null properties or trailing nil list entries
-- cannot have those distinctions reconstructed by an observational probe.
local function is_null(v)
  if v == nil or rawequal(v, NULL) then return true end
  for _, mod in ipairs({ rt and rt.values or false, package.loaded['rt.json'] or false }) do
    if type(mod) == 'table' then
      for _, key in ipairs({ 'null', 'NULL', 'undefined', 'UNDEFINED' }) do
        local sentinel = rawget(mod, key)
        if sentinel ~= nil and type(sentinel) ~= 'function' and rawequal(v, sentinel) then
          return true
        end
      end
    end
  end
  return false
end

local function encode(v, active, depth)
  if is_null(v) then return 'null' end
  local typ = type(v)
  if typ == 'string' then return quote(v) end
  if typ == 'boolean' then return v and 'true' or 'false' end
  if typ == 'number' then
    -- NekoC Cell::Number delegates to serde_json: NaN and +/-Inf become null.
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    return (string.format('%.17g', v):gsub(',', '.'))
  end
  if typ ~= 'table' then error('unserializable value type: ' .. typ, 0) end
  active, depth = active or {}, depth or 0
  if active[v] or depth >= 128 then error('cyclic or excessively deep snapshot value', 0) end
  active[v] = true
  local shape, max_index, numeric, metadata = shapes[v], 0, false, false
  if shape ~= 'object' then
    for k in pairs(v) do
      if type(k) == 'number' and k >= 1 and k % 1 == 0 then
        numeric = true
        max_index = math.max(max_index, k)
      elseif k == '__ver' or k == '__set' then
        metadata = true
      elseif shape ~= 'array' then
        shape = 'object'
      else
        error('non-index data in a declared list: ' .. tostring(k), 0)
      end
    end
  end
  local parts = {}
  if shape == 'array' or (shape ~= 'object' and (numeric or metadata)) then
    for i = 1, max_index do parts[i] = encode(v[i], active, depth + 1) end
    active[v] = nil
    return '[' .. table.concat(parts, ',') .. ']'
  end
  local keys = {}
  for k in pairs(v) do
    if type(k) ~= 'string' and type(k) ~= 'number' then error('invalid object key', 0) end
    keys[#keys + 1] = k
  end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  for _, k in ipairs(keys) do
    parts[#parts + 1] = quote(tostring(k)) .. ':' .. encode(v[k], active, depth + 1)
  end
  active[v] = nil
  return '{' .. table.concat(parts, ',') .. '}'
end

local function variables(vars, lists, list_meta, entity_scope)
  local result = object()
  for k, v in pairs(lists or {}) do
    result[k] = v
    -- Core entity.lists also aliases table-valued scalar variables. Do not
    -- mistake an object variable for a list just because it has this alias.
    if type(v) == 'table' and (not entity_scope or (list_meta and list_meta[k])) then
      shapes[v] = 'array'
    end
  end
  for k, v in pairs(vars or {}) do
    result[k] = v
    if type(v) == 'table' and list_meta and list_meta[k] then shapes[v] = 'array' end
  end
  return result
end

local function snapshot()
  local g = rt and rt.game
  if not g then return NULL end
  local actors, entity_variables = object(), object()
  for _, e in ipairs(g.entities or {}) do
    if e.kind == 'actor' and not e.deleted then
      local origin, seen = e, {}
      while origin.parent and not seen[origin] do
        seen[origin] = true
        origin = origin.parent
      end
      -- Read backing fields only: no get_var/get_list calls that could materialize
      -- values, and no style/drawing methods that could populate runtime caches.
      actors[e.id] = object({ id = e.id, prototype_id = origin.id, name = e.name,
        x = e.x, y = e.y, rotation = e.dir,
        current_style_id = (e.styles and e.styles[e.style_index]) or NULL,
        scale = e.scale_x and e.scale_x * 100,
        scale_y = e.scale_y and e.scale_y * 100, visible = e.visible })
      entity_variables[e.id] = variables(e.vars, e.lists, g.list_meta, true)
    end
  end
  return object({ frame = frame_count, current_scene_id = g.cur_screen or NULL,
    actors = actors, variables = variables(g.vars, g.lists, g.list_meta),
    entity_variables = entity_variables })
end

local function missing_primitives()
  local found, result = {}, array()
  local g = rt and rt.game
  for _, name in ipairs(g and g.missing_primitives or {}) do found[tostring(name)] = true end
  for name in pairs(rt and rt.stats and rt.stats.missing or {}) do found[tostring(name)] = true end
  -- Compiler-declared unsupported blocks may not execute on the sampled path.
  for k, v in pairs(g and g.work and g.work.unsupported_blocks or {}) do
    local name = type(k) == 'number' and v or k
    if type(name) == 'string' then found[name] = true end
  end
  for name in pairs(found) do result[#result + 1] = name end
  table.sort(result)
  return result
end

-- OS process high-water working set, not Lua heap size. Unsupported hosts use
-- null rather than a misleading collectgarbage('count') substitute.
local read_peak_rss = function() return NULL end
do
  local ok, ffi = pcall(original_require, 'ffi')
  if ok and ffi.os == 'Windows' then
    local installed, reader = pcall(function()
      ffi.cdef[[
        typedef struct {
          unsigned long cb, PageFaultCount;
          size_t PeakWorkingSetSize, WorkingSetSize, QuotaPeakPagedPoolUsage,
            QuotaPagedPoolUsage, QuotaPeakNonPagedPoolUsage,
            QuotaNonPagedPoolUsage, PagefileUsage, PeakPagefileUsage;
        } HNBENCH_PROCESS_MEMORY_COUNTERS;
        void * __stdcall GetCurrentProcess(void);
        int __stdcall GetProcessMemoryInfo(void *, HNBENCH_PROCESS_MEMORY_COUNTERS *, unsigned long);
      ]]
      local psapi = ffi.load('psapi')
      local counters = ffi.new('HNBENCH_PROCESS_MEMORY_COUNTERS[1]')
      return function()
        counters[0].cb = ffi.sizeof(counters[0])
        if psapi.GetProcessMemoryInfo(ffi.C.GetCurrentProcess(), counters, counters[0].cb) ~= 0 then
          return tonumber(counters[0].PeakWorkingSetSize)
        end
        return NULL
      end
    end)
    if installed then read_peak_rss = reader end
  end
end

local function quit(code)
  if love and love.event and love.event.quit then love.event.quit(code) end
end

local function finish(reason)
  if finished then return end
  finished = true
  -- Read RSS before allocating the diagnostic snapshot/JSON.
  local ok_rss, rss = pcall(read_peak_rss)
  local ok_state, state = pcall(snapshot)
  if not ok_state then record('snapshot', state); state = NULL end
  local result = object({ schema = 'nekoc-performance-v1', runtime = 'hateneko',
    input = work_name or (type(STARTUP) == 'table' and STARTUP.work) or NULL,
    seed = 1, warmup = warmup, frames = frames, completed_frames = frame_count,
    import_ms = import_ms or NULL, start_ms = start_ms or NULL, load_ms = load_ms or NULL,
    frame_ms = frame_ms, warmup_ms = warmup_ms, peak_rss_bytes = ok_rss and rss or NULL,
    final_state = state, missing_primitives = missing_primitives(), errors = errors,
    status = #errors == 0 and 'ok' or 'error', stop_reason = reason,
    measurement = object({ dt = 1 / 60, frame_scope = 'rt.step',
      import_scope = 'probe entry through successful rt.start return, including preload/start; conf.lua work require may precede probe',
      work_cached_at_probe_entry = work_cached_at_entry,
      random_sequence = 'Lua math.randomseed(1), not NekoC RNG parity' }) })
  local ok_json, text = pcall(encode, result)
  if not ok_json then
    record('serialization', text)
    result.final_state, result.status = NULL, 'error'
    ok_json, text = pcall(encode, result)
  end
  local ok_write, err = pcall(function()
    assert(ok_json, text)
    assert(output:match('^%a:[/\\]') or output:match('^[/\\][/\\]') or output:sub(1, 1) == '/',
      'HNBENCH_OUT must be an absolute path')
    local file = assert(io.open(output, 'wb'))
    local wrote, write_error = file:write(text, '\n')
    local closed, close_error = file:close()
    assert(wrote, write_error)
    assert(closed, close_error)
  end)
  if not ok_write then io.stderr:write('hnbench: output failed: ', tostring(err), '\n') end
  quit(ok_write and #errors == 0 and 0 or 1)
end

local log_depth = setmetatable({}, { __mode = 'k' })
local function hook_host(host)
  if type(host) ~= 'table' then return end
  for _, method in ipairs({ 'log', 'error' }) do
    local original = host[method]
    if type(original) == 'function' and not wrapped[original] then
      local wrapper = function(self, message, ...)
        local depth = log_depth[self] or 0
        if depth == 0 and (method == 'error' or select(1, ...) == 'error' or select(1, ...) == 'fatal') then
          record('host:' .. method, message)
        end
        log_depth[self] = depth + 1
        local result = pack(original(self, message, ...))
        log_depth[self] = depth
        return returns(result)
      end
      wrapped[wrapper], host[method] = true, wrapper
    end
  end
end

local function hook_game()
  local g = rt and rt.game
  if not g then return end
  hook_host(rt.host)
  local original = g.on_error
  if not (original and wrapped[original]) then
    local wrapper = function(th, err, ...)
      record('rt.game.on_error', err, th)
      if original then return original(th, err, ...) end
    end
    wrapped[wrapper], g.on_error = true, wrapper
  end
end

local function hook_runtime(runtime)
  if rt == runtime then return end
  rt = runtime
  local original_load, original_start, original_step = rt.load, rt.start, rt.step
  rt.load = function(...)
    local t = now()
    local result = pack(original_load(...))
    load_ms = (now() - t) * 1000
    hook_game()
    return returns(result)
  end
  rt.start = function(...)
    hook_game()
    local t = now()
    local result = pack(original_start(...))
    local ended = now()
    start_ms, import_ms, started = (ended - t) * 1000, (ended - began) * 1000, true
    return returns(result)
  end
  rt.step = function(_, ...)
    hook_game()
    local t = now()
    local result = pack(original_step(1 / 60, ...))
    local elapsed = (now() - t) * 1000
    -- Count only completed runtime steps, never loading updates or draws.
    if started and not finished then
      frame_count = frame_count + 1
      local samples = frame_count <= warmup and warmup_ms or frame_ms
      samples[#samples + 1] = elapsed
      if frame_count >= warmup + frames then pending = true end
    end
    return returns(result)
  end
end

local function hook_constructor(module)
  if type(module) ~= 'table' or type(module.new) ~= 'function' or wrapped[module.new] then return end
  local original = module.new
  local wrapper = function(...)
    local result = pack(original(...))
    hook_host(result[1])
    return returns(result)
  end
  wrapped[wrapper], module.new = true, wrapper
end

_G.require = function(name, ...)
  local result = pack(original_require(name, ...))
  if name == 'rt.init' then hook_runtime(result[1]) end
  if name == 'rt.host.love' then hook_constructor(result[1]) end
  return returns(result)
end
if type(package.loaded['rt.init']) == 'table' then hook_runtime(package.loaded['rt.init']) end
if type(package.loaded['rt.host.love']) == 'table' then hook_constructor(package.loaded['rt.host.love']) end

local function install_errorhandler()
  -- Do not invoke the stock interactive error screen. LÖVE calls the returned
  -- function as a replacement run loop; returning 1 makes the failure headless.
  love.errorhandler = function(message)
    record('love.errorhandler', debug.traceback(tostring(message), 2))
    finish('love.errorhandler')
    return function() return 1 end
  end
end
install_errorhandler()

-- main.lua defines its callbacks AFTER requiring us. love.run is invoked only
-- after those definitions, so wrap there rather than replacing love.update.
local original_run = love.run
love.run = function(...)
  local original_load, original_update, original_draw, original_quit = love.load, love.update, love.draw, love.quit
  -- Disable only the player's built-in scripted input/screenshot modes. Its
  -- normal update/draw, preload, UI and event handlers remain intact.
  for _, callback in ipairs({ original_load or false, original_update or false, original_draw or false }) do
    if type(callback) == 'function' then
      local i = 1
      while true do
        local name, value = debug.getupvalue(callback, i)
        if not name then break end
        if (name == 'PROBE' or name == 'SHOT') and type(value) == 'table' then value.on = false end
        i = i + 1
      end
    end
  end
  install_errorhandler()
  love.load = function(args, ...)
    local function count(name, default, minimum)
      local value = os.getenv(name)
      if not value or value == '' then return default end
      local n = tonumber(value)
      assert(n and n >= minimum and n <= 100000 and n % 1 == 0, 'invalid ' .. name)
      return n
    end
    frames, warmup = count('HNBENCH_FRAMES', 300, 1), count('HNBENCH_WARMUP', 60, 0)
    assert(frames + warmup <= 100000, 'too many total benchmark frames')
    STARTUP = type(STARTUP) == 'table' and STARTUP or {}
    STARTUP.probe = false
    if work_name and work_name ~= '' then STARTUP.work = work_name end
    local filtered = {}
    for _, arg in ipairs(args or {}) do
      if arg ~= 'probe' and arg ~= 'shot' then filtered[#filtered + 1] = arg end
    end
    local result = original_load and pack(original_load(filtered, ...)) or pack()
    math.randomseed(1)
    hook_game() -- main.lua may have assigned on_error after rt.load returned.
    if #errors > 0 then finish('load error') end
    return returns(result)
  end
  love.update = function(...)
    hook_game()
    local result = original_update and pack(original_update(...)) or pack()
    if #errors > 0 then finish('runtime error')
    elseif pending and not original_draw then finish('frames complete')
    elseif not started and rt and not rt.game then
      record('load', 'love.update completed without a loaded game')
      finish('load failed')
    end
    return returns(result)
  end
  if original_draw then
    love.draw = function(...)
      local result = pack(original_draw(...))
      if #errors > 0 then finish('draw error')
      elseif pending then finish('frames complete') end
      return returns(result)
    end
  end
  love.quit = function(...)
    local result = original_quit and pack(original_quit(...)) or pack()
    if not finished then
      record('love.quit', 'player quit before completing requested steps')
      finish('early quit')
    end
    return returns(result)
  end
  local result = pack(original_run(...))
  if type(result[1]) == 'function' then
    local original_loop = result[1]
    result[1] = function(...)
      local values = pack(original_loop(...))
      -- LÖVE can skip draw while minimized. Still stop at exactly the requested
      -- number of completed steps, after the unmodified loop has had a chance
      -- to draw/present, rather than counting extra updates until a draw occurs.
      if pending and not finished then finish('frames complete') end
      return returns(values)
    end
  end
  return returns(result)
end

return { enabled = true }
