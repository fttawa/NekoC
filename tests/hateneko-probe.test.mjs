import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Load only the LuaJIT DLL, not love.exe/lovec.exe: these tests never create a
// window, run a benchmark, or need a copy of the external HateNeko runtime.
// Other installations can opt in with HNBENCH_LUA_DLL/HNBENCH_PYTHON.
const dll = process.env.HNBENCH_LUA_DLL ?? "D:/Tools/love-11.5-win64/lua51.dll";
const python = process.env.HNBENCH_PYTHON ?? "python";
const probe = fileURLToPath(new URL("../tools/bench/hateneko-probe.lua", import.meta.url));
const pythonCheck = spawnSync(python, ["--version"], { encoding: "utf8", windowsHide: true });
const unavailable = !existsSync(dll) ? "LuaJIT DLL unavailable (set HNBENCH_LUA_DLL)"
  : pythonCheck.status !== 0 ? "Python unavailable (set HNBENCH_PYTHON)" : false;

const bridge = String.raw`
import ctypes, json, os, sys
request = json.load(sys.stdin)
# Keep the directory cookie alive until the Lua state has been closed.
directory = os.add_dll_directory(os.path.dirname(os.path.abspath(request['dll']))) if os.name == 'nt' else None
lua = ctypes.CDLL(request['dll'])
lua.luaL_newstate.restype = ctypes.c_void_p
lua.luaL_openlibs.argtypes = [ctypes.c_void_p]
lua.luaL_loadstring.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
lua.luaL_loadstring.restype = ctypes.c_int
lua.lua_pcall.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int]
lua.lua_pcall.restype = ctypes.c_int
lua.lua_getfield.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p]
lua.lua_tolstring.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_size_t)]
lua.lua_tolstring.restype = ctypes.c_void_p
lua.lua_close.argtypes = [ctypes.c_void_p]
state = lua.luaL_newstate()
if not state:
    raise RuntimeError('luaL_newstate failed')
def text(index):
    size = ctypes.c_size_t()
    pointer = lua.lua_tolstring(state, index, ctypes.byref(size))
    if not pointer:
        raise RuntimeError('Lua did not return a string')
    return ctypes.string_at(pointer, size.value).decode('utf-8')
try:
    lua.luaL_openlibs(state)
    status = lua.luaL_loadstring(state, request['code'].encode('utf-8'))
    if status == 0:
        status = lua.lua_pcall(state, 0, 0, 0)
    if status != 0:
        raise RuntimeError(text(-1))
    lua.lua_getfield(state, -10002, b'HARNESS_RESULT') # LUA_GLOBALSINDEX, Lua 5.1
    sys.stdout.write(text(-1))
finally:
    lua.lua_close(state)
`;

function runLua(code) {
  const child = spawnSync(python, ["-c", bridge], {
    input: JSON.stringify({ dll, code: `assert(jit and jit.version:find('LuaJIT'), 'requires LuaJIT')\n${code}` }),
    encoding: "utf8", windowsHide: true, timeout: 15_000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

// JSON string literals are also Lua literals for these ASCII paths/options.
const literal = value => JSON.stringify(value);

function exercise(options = {}) {
  return runLua(`
local options = { frames = ${literal(String(options.frames ?? 3))}, warmup = ${literal(String(options.warmup ?? 2))},
  draw = ${options.draw !== false}, minimized = ${!!options.minimized},
  error_mode = ${literal(options.error ?? "")}, rss = ${literal(options.rss ?? "native")},
  prestart_step = ${!!options.prestartStep} }
local env = { HNBENCH_OUT = '/mock/probe.json', HNBENCH_FRAMES = options.frames,
  HNBENCH_WARMUP = options.warmup, HNBENCH_WORK = 'test-work' }
os.getenv = function(name) return env[name] end
collectgarbage = function() error('Lua heap is not process peak RSS') end
local original_require = require
if options.rss ~= 'native' then
  require = function(name, ...)
    if name ~= 'ffi' then return original_require(name, ...) end
    if options.rss == 'unsupported' then return { os = 'Unsupported' } end
    return { os = 'Windows', cdef = function() end, sizeof = function() return 80 end,
      new = function() return { [0] = {} } end,
      C = { GetCurrentProcess = function() return 123 end },
      load = function(name)
        assert(name == 'psapi')
        return { GetProcessMemoryInfo = function(handle, counters, size)
          assert(handle == 123 and size == 80 and counters[0].cb == 80)
          counters[0].PeakWorkingSetSize = 87654321
          counters[0].WorkingSetSize = 1234
          return options.rss == 'failed' and 0 or 1
        end }
      end }
  end
end
local clock, steps, updates, draws, writes, closes = 0, 0, 0, 0, 0, 0
local output, quit_codes, stderr = nil, {}, ''
io.open = function(path, mode)
  assert(path == env.HNBENCH_OUT and mode == 'wb')
  return { write = function(_, text, newline)
    writes = writes + 1
    assert(newline == '\\n')
    output = text
    return true
  end, close = function() closes = closes + 1; return true end }
end
io.stderr = { write = function(_, ...) stderr = stderr .. table.concat({...}) end }
local actor = { kind = 'actor', id = 'actor', name = 'sprite', x = 0, y = -4,
  dir = 90, scale_x = 1.25, scale_y = 0.5, visible = true, styles = {'style'}, style_index = 1,
  vars = { local_value = 7 }, lists = {} }
local game = { entities = {actor}, vars = {}, lists = {}, cur_screen = 'scene',
  work = {}, list_meta = {} }
local runtime = {
  host = { log = function() end, error = function() end },
  load = function() clock = clock + 0.011; return 'load', nil, 3 end,
  start = function() clock = clock + 0.013; return 'start', nil, 4 end,
  step = function(dt, extra)
    assert(dt == 1 / 60 and extra == 'extra', 'probe must override variable player dt')
    clock = clock + 0.002; steps = steps + 1; actor.x = steps
    if options.error_mode == 'runtime' then
      game.on_error({owner = {id = 'owner'}, hat = 'hat'}, 'step failed')
    end
    return 'step', nil, 5
  end }
local function same_returns(expected, ...)
  assert(select('#', ...) == 3)
  local a, b, c = ...
  assert(a == expected and b == nil and type(c) == 'number')
end
local PROBE, SHOT = {on = true}, {on = true}
STARTUP = { work = 'original', probe = true }
love = {
  timer = { getTime = function() return clock end },
  event = { quit = function(code) quit_codes[#quit_codes + 1] = code end },
  load = function(args)
    assert(not PROBE.on and not SHOT.on and not STARTUP.probe)
    assert(STARTUP.work == 'test-work')
    assert(#args == 2 and args[1] == 'keep' and args[2] == '--flag')
    runtime = require('rt.init')
    same_returns('load', runtime.load())
    runtime.game = game
    if options.prestart_step then same_returns('step', runtime.step(0.8, 'extra')) end
    same_returns('start', runtime.start())
    if options.error_mode == 'load' then runtime.host:error('load failed') end
    return 'load', nil, 3
  end,
  update = function(dt)
    updates = updates + 1; clock = clock + 0.2
    same_returns('step', runtime.step(dt, 'extra'))
    return 'update', nil, 6
  end,
  quit = function() return 'quit', nil, 8 end }
if options.draw then
  love.draw = function()
    assert(not PROBE.on and not SHOT.on)
    draws = draws + 1; clock = clock + 0.3
    if options.error_mode == 'draw' then runtime.host:log('draw failed', 'fatal') end
    return 'draw', nil, 7
  end
end
package.preload['rt.init'] = function() return runtime end
love.run = function()
  same_returns('load', love.load({'probe', 'keep', 'shot', '--flag'}))
  return function()
    same_returns('update', love.update(0.9))
    if love.draw and not options.minimized then same_returns('draw', love.draw()) end
    clock = clock + 0.4 -- event loop / present work must not enter frame_ms
    return 'loop', nil, 9
  end
end
assert(assert(loadfile(${literal(probe)}))().enabled)
local loop
local ok, err = pcall(function() loop = love.run() end)
if not ok then
  assert(options.error_mode == 'invalid-count', err)
  assert(love.errorhandler(err)() == 1)
elseif options.error_mode == 'early-quit' then
  same_returns('quit', love.quit())
elseif options.error_mode == 'errorhandler' then
  assert(love.errorhandler('unhandled exception')() == 1)
else
  for i = 1, 20 do
    if #quit_codes > 0 then break end
    same_returns('loop', loop())
  end
end
assert(#quit_codes == 1, 'probe did not terminate exactly once')
same_returns('quit', love.quit()) -- finish must be idempotent
assert(#quit_codes == 1 and writes == 1 and closes == 1 and stderr == '')
HARNESS_RESULT = '{"report":' .. assert(output) .. ',"exit":' .. quit_codes[1]
  .. ',"steps":' .. steps .. ',"updates":' .. updates .. ',"draws":' .. draws .. '}'
`);
}

test("HateNeko probe is inert for missing and empty HNBENCH_OUT", { skip: unavailable }, () => {
  for (const value of ["nil", "''"]) {
    const result = runLua(`
local loader = assert(loadfile(${literal(probe)}))
local getenv_calls = 0
os.getenv = function(name)
  assert(name == 'HNBENCH_OUT'); getenv_calls = getenv_calls + 1; return ${value}
end
local poison = setmetatable({}, {__index = function() error('inert probe accessed host') end,
  __newindex = function() error('inert probe modified host') end})
love, STARTUP, io = poison, poison, poison
local original_require = function() error('inert probe required a module') end
require = original_require
local result = loader()
assert(result.enabled == false and getenv_calls == 1 and require == original_require and love == poison)
HARNESS_RESULT = '{"enabled":false}'
`);
    assert.equal(result.enabled, false);
  }
});

test("HateNeko samples exactly warmup + measured completed steps, including minimized loops", { skip: unavailable }, () => {
  for (const mode of [{}, { minimized: true }, { draw: false }]) {
    const { report, exit, steps, updates, draws } = exercise(mode);
    assert.equal(exit, 0);
    assert.equal(report.status, "ok");
    assert.equal(report.stop_reason, "frames complete");
    assert.equal(report.completed_frames, 5);
    assert.equal(steps, 5);
    assert.equal(updates, 5);
    assert.equal(draws, mode.minimized || mode.draw === false ? 0 : 5);
    assert.equal(report.warmup_ms.length, 2);
    assert.equal(report.frame_ms.length, 3);
    assert.equal(report.final_state.frame, 5);
    assert.equal(report.final_state.actors.actor.x, 5);
  }
});

test("HateNeko timing excludes player update/draw/present and steps before rt.start", { skip: unavailable }, () => {
  const { report, steps } = exercise({ prestartStep: true, frames: 1, warmup: 0 });
  assert.equal(steps, 2);
  assert.equal(report.completed_frames, 1);
  assert.deepEqual(report.warmup_ms, []);
  assert.equal(report.frame_ms.length, 1);
  assert.ok(Math.abs(report.frame_ms[0] - 2) < 1e-8);
  assert.ok(Math.abs(report.load_ms - 11) < 1e-8);
  assert.ok(Math.abs(report.start_ms - 13) < 1e-8);
  assert.ok(Math.abs(report.import_ms - 26) < 1e-8);
  assert.equal(report.measurement.frame_scope, "rt.step");
  assert.equal(report.measurement.dt, 1 / 60);
});

test("HateNeko snapshots express actor scales in percent, not runtime fractions", { skip: unavailable }, () => {
  const { report } = exercise({ frames: 1, warmup: 0 });
  assert.equal(report.final_state.actors.actor.scale, 125);
  assert.equal(report.final_state.actors.actor.scale_y, 50);
});

test("HateNeko RSS uses the OS high-water counter, never collectgarbage heap size", { skip: unavailable }, () => {
  const native = exercise({ rss: "native", frames: 1, warmup: 0 }).report;
  assert.equal(native.status, "ok");
  if (process.platform === "win32") assert.ok(native.peak_rss_bytes > 0);
  else assert.equal(native.peak_rss_bytes, null);
  assert.equal(exercise({ rss: "mock" }).report.peak_rss_bytes, 87654321);
  for (const rss of ["unsupported", "failed"]) {
    const { report, exit } = exercise({ rss });
    assert.equal(report.peak_rss_bytes, null);
    assert.equal(exit, 0);
  }
});

test("HateNeko load/runtime/draw errors and early quits write diagnostics and exit nonzero", { skip: unavailable }, () => {
  for (const [error, source, reason, completed] of [
    ["load", "host:error", "load error", 0],
    ["runtime", "rt.game.on_error", "runtime error", 1],
    ["draw", "host:log", "draw error", 1],
    ["early-quit", "love.quit", "early quit", 0],
    ["errorhandler", "love.errorhandler", "love.errorhandler", 0],
  ]) {
    const { report, exit } = exercise({ error });
    assert.equal(exit, 1, error);
    assert.equal(report.status, "error", error);
    assert.equal(report.stop_reason, reason, error);
    assert.equal(report.completed_frames, completed, error);
    assert.equal(report.errors.length, 1, error);
    assert.equal(report.errors[0].source, source, error);
    if (error === "runtime") {
      assert.equal(report.errors[0].owner_id, "owner");
      assert.equal(report.errors[0].hat, "hat");
    }
  }
});

test("HateNeko rejects invalid frame budgets before any runtime step", { skip: unavailable }, () => {
  for (const options of [
    { frames: 0 }, { frames: "NaN" }, { frames: 1.5 }, { warmup: -1 },
    { frames: 100001 }, { frames: 100000, warmup: 1 },
  ]) {
    const { report, exit, steps } = exercise({ ...options, error: "invalid-count" });
    assert.equal(exit, 1);
    assert.equal(steps, 0);
    assert.equal(report.status, "error");
    assert.equal(report.errors[0].source, "love.errorhandler");
    assert.match(report.errors[0].message, /invalid HNBENCH_|too many total benchmark frames/);
  }
});
