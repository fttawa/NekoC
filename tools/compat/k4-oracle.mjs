#!/usr/bin/env node
// Independent harness. Vendor files are only read/served from K4_PLAYER_DIR.
import { createServer } from "node:http";
import { readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "../probe-kitten4.mjs";

export function parseArgs(argv) {
  const args = { command: "run", frames: 60, seed: 1, channel: "msedge", timeoutMs: 45000 };
  if (argv[0] && !argv[0].startsWith("--")) args.command = argv.shift();
  const keys = { "--input": "input", "--out": "out", "--player-dir": "playerDir", "--channel": "channel",
     "--frames": "frames", "--seed": "seed", "--timeout-ms": "timeoutMs", "--diagnostics": "diagnostics",
     "--random-source": "randomSource", "--block-filter": "blockFilter" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--allow-assets") { args.allowAssets = true; continue; }
    if (argv[i] === "--blocks") { args.blocks = true; continue; }
    if (argv[i] === "--help" || argv[i] === "-h") { args.help = true; continue; }
    const key = keys[argv[i]];
    if (!key || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Invalid option: ${argv[i]}`);
    args[key] = argv[++i];
  }
  for (const key of ["frames", "seed", "timeoutMs"]) {
    args[key] = Number(args[key]);
    if (!Number.isSafeInteger(args[key]) || args[key] < (key === "timeoutMs" ? 1 : 0)) throw new Error(`Invalid ${key}`);
  }
  if (args.seed > 0xffffffff) throw new Error("seed must fit uint32");
  if (args.randomSource && !["pcg", "nekoc"].includes(args.randomSource)) throw new Error("Invalid random-source");
  if (!["run", "compile"].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  return args;
}

export async function readJson(file) {
  return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
}

export async function saveJson(file, value) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

// Workspace exports can omit runtime actor order. This is a harness adaptation,
// not an assertion about official editor serialization; recorded in diagnostics.
export function runtimeProject(input) {
  const project = structuredClone(input);
  const th = project.theatre;
  if (!th?.scenes || !th.actors) throw new Error("Expected Kitten 4 theatre.scenes/actors");
  const adaptations = [];
  for (const [id, scene] of Object.entries(th.scenes)) {
    if (scene.actors?.length) continue;
    const ordered = [], visited = new Set();
    function walk(gid) {
      if (visited.has(gid)) return;
      visited.add(gid);
      const group = th.groups?.[gid];
      if (!group) return;
      if (group.is_group) (group.group_order || group.groups || []).forEach(walk);
      else ordered.push(...(group.actors || []));
    }
    (scene.group_order || []).forEach(walk);
    scene.actors = [...new Set(ordered.reverse())];
    for (const [aid, actor] of Object.entries(th.actors)) {
      if (actor.scene === id && !scene.actors.includes(aid)) scene.actors.push(aid);
    }
    if (scene.actors.length) adaptations.push(`filled scene actors: ${id}`);
  }
  return { project, adaptations };
}

// Published CDN images often have extensionless base64 keys; the player appends
// imageView2 transformations. Permit only declared media on the existing CDN
// allowlist, never arbitrary extensionless API endpoints.
export function projectAssetUrls(project) {
  const urls = new Set();
  for (const entries of [project.theatre?.styles, project.theatre?.videos, project.audio]) {
    for (const item of Object.values(entries || {})) for (const key of ["url", "cdn_url"]) {
      if (typeof item[key] === "string") {
        try { urls.add(new URL(item[key]).href); } catch { /* Inline/local assets need no external permission. */ }
      }
    }
  }
  return urls;
}

export function allowedAsset(url, declared) {
  if (url.protocol !== "https:") return false;
  // Legacy and new media CDNs are allowed only for project-declared media.
  const declaredOnly = ["static.codemao.cn", "creation.bcmcdn.com"].includes(url.hostname);
  if (!declaredOnly && !["kn-cdn.codemao.cn", "cdn-community.codemao.cn", "creation.codemao.cn"].includes(url.hostname)) return false;
  if (!declaredOnly && /\.(?:json|png|jpe?g|svg|webp|gif|mp3|wav|ogg|mp4|woff2?|ttf)$/i.test(url.pathname)) return true;
  const base = new URL(url); base.search = "";
  return declared.has(url.href) || declared.has(base.href);
}

export async function openKernel(options, input) {
  const directory = options.playerDir || process.env.K4_PLAYER_DIR;
  if (!directory) throw new Error("Set K4_PLAYER_DIR or --player-dir to the external app directory");
  const app = await realpath(directory);
  const player = await realpath(path.join(app, "src/player"));
  const build = await realpath(path.join(player, "build"));
  const pageSource = await readFile(path.join(player, "page.html"), "utf8");
  // Read resource names only; never reuse the wrapper's scripts or HTML.
  const assets = [...pageSource.matchAll(/(?:src|href)=["'](\/kn\/build\/[^"']+)["']/g)].map(m => m[1]);
  if (!assets.some(url => /player_v2.*\.js$/.test(url))) throw new Error("Cannot discover player_v2 entry");
  const diagnostics = { assets: [], localRequests: [], externalRequests: [], failedRequests: [], missingLocal: [], pageErrors: [], console: [], adaptations: [] };
  let served = structuredClone(input);
  let declaredAssets = projectAssetUrls(served);
  let origin;
  const tokenPath = "/new/abcdef0123456789";
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const entry = { url: req.url, method: req.method, destination: req.headers["sec-fetch-dest"] || "" };
      diagnostics.localRequests.push(entry);
      const send = (status, type, body) => { entry.status = status; res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
      if (req.method !== "GET" && req.method !== "HEAD") return send(405, "text/plain", "read only");
      if (url.pathname === tokenPath) {
        if (req.headers["sec-fetch-dest"] !== "document") return send(200, "application/json", JSON.stringify(served));
        const tags = assets.map(url => url.endsWith(".css") ? `<link rel="stylesheet" href="${url}">` : `<script src="${url}"></script>`).join("\n");
        return send(200, "text/html", `<!doctype html><meta charset="utf-8"><div id="root"></div>${tags}`);
      }
      if (url.pathname === "/new/client_config.json") {
        const cfg = JSON.parse(await readFile(path.join(player, "client_config.json"), "utf8"));
        Object.assign(cfg, { creation_api: origin, api: { ...cfg.api, host: origin, port: "" }, open_service_api: origin,
          cloud_storage_api: origin, wss_cloud_storage_api: "" });
        return send(200, "application/json", JSON.stringify(cfg));
      }
      if (url.pathname === "/web/users/details") return send(401, "application/json", '{"error":"unauthorized"}');
      if (url.pathname.startsWith("/kn/build/")) {
        const name = decodeURIComponent(url.pathname.slice("/kn/build/".length));
        if (name.includes("/") || name.includes("\\") || name.startsWith(".")) return send(403, "text/plain", "forbidden");
        let file = path.join(build, name);
        // Prefer pre-optimization player. Fail closed instead of calling patched code official.
        if (/^player_v2.*\.js$/.test(name)) file += ".orig";
        const resolved = await realpath(file);
        if (path.dirname(resolved) !== build) return send(403, "text/plain", "forbidden");
        const data = await readFile(resolved);
        if (!diagnostics.assets.some(a => a.name === name)) diagnostics.assets.push({ name, source: path.basename(file), sha256: createHash("sha256").update(data).digest("hex") });
        return send(200, name.endsWith(".js") ? "application/javascript" : name.endsWith(".css") ? "text/css" : "application/octet-stream", data);
      }
      diagnostics.missingLocal.push(url.pathname);
      send(404, "text/plain", "not found");
    } catch (error) {
      diagnostics.missingLocal.push({ url: req.url, error: error.message });
      res.writeHead(404); res.end("not found");
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await loadPlaywright().chromium.launch({ headless: true, channel: options.channel || "msedge" });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
    // Fresh anonymous context; deny ALL external traffic, including cloud data/telemetry.
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
      const asset = options.allowAssets && request.method() === "GET" && allowedAsset(url, declaredAssets);
      const entry = { url: url.href, method: request.method(), resourceType: request.resourceType(), action: asset ? "asset-fetch" : "blocked" };
      diagnostics.externalRequests.push(entry);
      if (asset) {
        try {
          // Node fetch forwards no browser cookies, authorization or referrer. No redirects.
          const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
          entry.status = response.status;
          return route.fulfill({ status: response.status, contentType: response.headers.get("content-type") || "application/octet-stream", body: Buffer.from(await response.arrayBuffer()) });
        } catch (error) { entry.error = error.message; }
      }
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket(/.*/, socket => {
      diagnostics.externalRequests.push({ url: socket.url(), resourceType: "websocket", action: "blocked" });
      socket.close();
    });
    const page = await context.newPage();
    page.on("pageerror", e => diagnostics.pageErrors.push(e.message));
    page.on("requestfailed", request => diagnostics.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on("console", m => { if (diagnostics.console.length < 200) diagnostics.console.push({ type: m.type(), text: m.text() }); });
    await page.addInitScript(() => {
      // Hold rAF until the harness explicitly advances a frame; boot uses real timers.
      const callbacks = new Map(); let serial = 0;
      window.requestAnimationFrame = callback => { callbacks.set(++serial, callback); return serial; };
      window.cancelAnimationFrame = id => callbacks.delete(id);
      window.__k4OracleFrame = timestamp => {
        const batch = [...callbacks.values()]; callbacks.clear();
        for (const callback of batch) callback(timestamp);
      };
    });
    const timeout = options.timeoutMs || 45000;
    async function load(project) {
      served = project;
      declaredAssets = projectAssetUrls(project);
      diagnostics.phase = "document";
      await page.goto(origin + tokenPath, { waitUntil: "load", timeout });
      // The supplied .orig exposes its DI container. Wait for the application's
      // own initialization; creating the heart early races saga/store setup.
      diagnostics.phase = "container";
      await page.waitForFunction(() => window.__k4c && window.__k4b, null, { timeout, polling: 20 });
      await page.evaluate(async () => {
        if (!window.webpackJsonp?.push) throw new Error("Missing webpack runtime");
        window.webpackJsonp.push([["nekoc-oracle"], { "nekoc-oracle": (m, e, req) => { window.__k4OracleRequire = req; } }, [["nekoc-oracle"]]]);
        const req = window.__k4OracleRequire;
        await new Promise(resolve => req("WFO7").c(resolve));
        window.__k4OracleContainer = req("KmiX").b().container;
        window.__k4OracleBinding = req("dET1").BINDING;
      });
      diagnostics.phase = "container-ready";
    }
    await load(served);
    return { page, diagnostics, load, close: async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
  } catch (error) {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    error.diagnostics = diagnostics;
    throw error;
  }
}

export async function compileProject(page, project) {
  return page.evaluate(project => {
    const container = window.__k4OracleContainer, binding = window.__k4OracleBinding;
    const compiler = container.get(binding.JSONEntityCompiler);
    const util = container.get(binding.Util);
    const result = [];
    // API contract inspected locally in player_v2; no wrapper/compiler source is embedded.
    for (const section of ["scenes", "actors"]) for (const [id, entity] of Object.entries(project.theatre[section])) {
      const workspace = entity.block_data_json;
      if (!workspace) throw new Error(`Missing block_data_json: ${id}`);
      const compiled = util.misc.ce_without_cyclical_references(compiler.compile({ id, blocksJSON: workspace }));
      const numericLiteral = node => {
        if (typeof node?.params?.NUM === "number") node.params.NUM = `${node.params.NUM}`;
      };
      for (const tree of Object.values(compiled.compiled_block_map)) util.block.ast_for_each(tree, numericLiteral);
      for (const tree of Object.values(compiled.procedures)) util.block.ast_for_each(tree, numericLiteral);
      compiled.running_group_id = {};
      const scene = section === "scenes" ? id : entity.scene;
      if (scene) for (const [root, tree] of Object.entries(compiled.compiled_block_map)) {
        if (!["start_on_click", "start_as_a_mirror"].includes(tree.type)) compiled.running_group_id[root] = scene;
      }
      result.push(compiled);
    }
    return result;
  }, project);
}

export async function runOracle(input, options = {}) {
  const { project, adaptations } = runtimeProject(input);
  // Published works already contain the official AST: load them directly. Only
  // editable works need an empty-AST bootstrap to access the native compiler.
  const bootstrap = structuredClone(project); bootstrap.compile_result = [];
  const needsCompile = options.command === "compile" || !Array.isArray(project.compile_result);
  const kernel = await openKernel(options, needsCompile ? bootstrap : project);
  kernel.diagnostics.adaptations = adaptations;
  kernel.diagnostics.instrumentation = [
    "external .orig bundle retains the wrapper's DI exposure; not independently authenticated upstream",
    "rAF held during load; official Start performs update 1, then one rAF batch per update",
    "native deterministic scheduler/PCG config; native Clock fixed to 1000/60 ms",
    "Math.random redirected at Start to a separate seeded native PCG instance",
    "get_timer uses native Date wall clock, not deterministic Clock; timer-dependent traces are not cross-run deterministic",
  ];
  if (options.randomSource === "nekoc") kernel.diagnostics.instrumentation.push(
    "random block calls only: xorshift64 override matches NekoC draws; incidental Math.random stays on native PCG");
  try {
    kernel.diagnostics.phase = "compile";
    if (needsCompile) project.compile_result = await compileProject(kernel.page, project);
    if (options.command === "compile") return { project, diagnostics: kernel.diagnostics };
    if (needsCompile) await kernel.load(project);
    kernel.diagnostics.phase = "project-assets";
    await kernel.page.waitForFunction(scene => {
      const req = window.__k4OracleRequire;
      const state = req("ALsR").a.get_state();
      return state.cloud_states.loading_state === "load_done" && state.theatre_states.scenes[scene] && req("a1xw").a().get_scene_by_id(scene);
    }, project.theatre.scenes_order?.[0] || Object.keys(project.theatre.scenes)[0], { timeout: options.timeoutMs || 45000, polling: 20 });
    kernel.diagnostics.phase = "trace";
    await kernel.page.evaluate(({ seed, blocks, randomSource, blockFilter }) => {
      const req = window.__k4OracleRequire;
      const heart = req("KmiX").b();
      const prngSeed = { seed_high: 0, seed_low: seed, inc_high: 0, inc_low: 1 };
      heart.set_config({ deterministic: { seconds_per_update: 1 / 60, prng_seed: prngSeed } });
      // player_v2's domain random block uses Math.random, not the heart PRNG.
      // Redirect that source to a separately seeded instance of the native PCG.
      const factory = window.__k4OracleContainer.get(window.__k4OracleBinding.PRNGFactory);
      const random = factory.create(prngSeed);
      let state = BigInt(seed) | 1n;
      const next = randomSource === "nekoc" ? () => {
        state = BigInt.asUintN(64, state ^ (state << 13n));
        state ^= state >> 7n;
        state = BigInt.asUintN(64, state ^ (state << 17n));
        return Number(state >> 11n) / 2 ** 53;
      } : () => random.random();
      Math.random = () => random.random();
      // Clock was constructed during boot, before deterministic config was set.
      const clock = window.__k4OracleContainer.get(window.__k4OracleBinding.Clock);
      clock.ms_per_update = 1000 / 60;
      clock.current_time = 0;
      const errors = [], frames = [];
      const events = [];
      let traceTruncated = false;
      const filter = blockFilter ? new Set(blockFilter.split(",")) : null;
      if (blocks || randomSource === "nekoc") {
        const manager = window.__k4OracleContainer.get(window.__k4OracleBinding.RuntimeManager);
        let current = null;
        const emit = (event, runner, extra = {}) => {
          if (!blocks) return;
          if (filter && event === "block" && !filter.has(extra.block)) return;
          if (events.length >= 500000) { traceTruncated = true; return; }
          const identities = runner?.original_identities;
          events.push({ frame: manager.frames + 1, event,
            entity: identities?.target_entity, hat: identities?.source_map_rbid, ...extra });
        };
        const spawn = manager.do_spawn_interpreter;
        function instrument(runner) {
          // OptiRunner mutates original_identities.source_map_rbid while entering
          // procedures. Freeze the script identity, not the current call frame.
          const identity = { ...runner.original_identities };
          const record = (event, extra = {}) => emit(event, { original_identities: identity }, extra);
          record("start", { priorities: runner.metadata.priorities,
            limits: { warpIterations: runner.max_warp_iterations_per_interpreter_step,
              procedureCalls: runner.max_procedure_calls_per_interpreter_step, deterministic: runner.deterministic_mode } });
          const step = runner.step;
          runner.step = function () {
            current = { original_identities: identity };
            record("resume");
            try {
              const result = step.call(this);
              record(result === req("eLij").StepResult.finished ? "finish" : "yield",
                { stack: this.program_state.proc_stack.map(f => ({ procedure: f.proc_id, pc: [...f.program_counter] })) });
              return result;
            } finally { current = null; }
          };
          const before = runner.step_outputs.before_expression;
          runner.step_outputs.before_expression = function (...args) {
            record("block", { block: args[0] });
            return before(...args);
          };
          const call = runner.step_input_outputs.call_domain_function;
          runner.step_input_outputs.call_domain_function = function (slot, index, block, params, entity) {
            const observed = filter?.has(block);
            if (observed) record("input", { block, type: runner.domain_function_types[index], params: structuredClone(params) });
            // Share only the random BLOCK input stream. UUIDs, rendering and
            // other incidental Math.random calls must not consume VM draws.
            const randomBlock = randomSource === "nekoc" && runner.domain_function_types[index] === "random";
            const mathRandom = Math.random, managerRandom = manager.get_random_number;
            let result;
            try {
              if (randomBlock) { Math.random = next; manager.get_random_number = next; }
              result = call.call(this, slot, index, block, params, entity);
            } finally {
              Math.random = mathRandom; manager.get_random_number = managerRandom;
            }
            if (observed) record("output", { block, value: structuredClone(runner.current_frame.dynamic_data[slot]) });
            return result;
          };
        }
        for (const runner of Object.values(manager.interpreters)) instrument(runner);
        manager.do_spawn_interpreter = function (spec) {
          const result = spawn.call(this, spec);
          instrument(this.interpreters[spec.interpreter_id]);
          return result;
        };
        // Observe the native notification boundary; do not replace list operations.
        for (const name of ["report_list_updated", "report_entity_list_updated"]) {
          const original = manager.runtime_data[name];
          if (typeof original !== "function") continue;
          manager.runtime_data[name] = function (...args) {
            emit("list", current, { list: args[0], length: args[1].length, owner: args[2] });
            return original.apply(this, args);
          };
        }
      }
      heart.get_event_bus().error.runtime.immediate.sub(e => errors.push(String(e.error?.message || e.error || e)));
      function snapshot() {
        const stage = req("a1xw").a();
        const manager = heart.get_runtime_manager();
        const data = heart.get_runtime_data();
        const state = req("ALsR").a.get_state();
        const actors = {}, variables = {}, variable_names = {}, entity_variables = {};
        for (const [id, entity] of Object.entries(state.theatre_states.actors)) {
          for (const aid of [id, ...(data.get_sprite_clones(id) || [])]) {
            const actor = stage.get_actor_by_id(aid);
            if (!actor) throw new Error(`Actor missing from official stage: ${aid}`);
            const scale = actor.get_scale();
            actors[aid] = { id: aid, prototype_id: id, name: entity.name, ...actor.get_position(),
              rotation: actor.get_rotation() * 180 / Math.PI, current_style_id: actor.get_current_style()?.style_id ?? null,
              scale: scale.x * 100, scale_y: scale.y * 100, visible: actor.get_visible() };
          }
        }
        for (const [id, variable] of Object.entries(state.variable_states)) {
          variable_names[id] = variable.name;
          variables[id] = manager.get_variable(id, undefined, variable.current_entity);
          if (!variable.is_global && variable.current_entity) {
            for (const owner of [variable.current_entity, ...(data.get_sprite_clones(variable.current_entity) || [])]) {
              (entity_variables[owner] ||= {})[id] = manager.get_variable(id, undefined, owner);
            }
          }
        }
        // Lists are mutable in the runtime: detach each frame, or later writes
        // would retroactively change every earlier snapshot.
        return structuredClone({ frame: frames.length + 1, current_scene_id: stage.core.scenes.get_current_scene(),
          actors, variables, variable_names, entity_variables });
      }
      heart.get_event_bus().runtime_manager.after_update.immediate.sub(() => frames.push(snapshot()));
      window.__k4Oracle = { frames, errors, heart, events, get traceTruncated() { return traceTruncated; } };
    }, { seed: options.seed ?? 1, blocks: !!options.blocks, randomSource: options.randomSource, blockFilter: options.blockFilter });
    if ((options.frames ?? 60) > 0) {
      await kernel.page.evaluate(() => window.__k4OracleRequire("vxpV").m());
      await kernel.page.waitForFunction(() => window.__k4Oracle.frames.length > 0 || window.__k4Oracle.errors.length > 0,
        null, { timeout: options.timeoutMs || 45000, polling: 20 });
      // Start emits the first update synchronously. Each subsequent rAF batch is
      // exactly one official scheduler update; never use wall-clock sleeps as frames.
      for (let frame = 1; frame < (options.frames ?? 60); frame++) {
        await kernel.page.evaluate(timestamp => window.__k4OracleFrame(timestamp), frame * 1000 / 60);
      }
    }
    const result = await kernel.page.evaluate(() => ({ frames: window.__k4Oracle.frames, errors: window.__k4Oracle.errors,
      events: window.__k4Oracle.events, traceTruncated: window.__k4Oracle.traceTruncated }));
    if (result.errors.length || result.frames.length !== (options.frames ?? 60)) {
      kernel.diagnostics.partialTrace = result;
      throw new Error(`Official runtime failed: ${JSON.stringify({ errors: result.errors, frames: result.frames.length })}`);
    }
    kernel.diagnostics.phase = "done";
    return { schema: "nekoc-k4-trace-v1", fps: 60, seed: options.seed ?? 1,
      random: options.randomSource === "nekoc" ? "NekoC xorshift64 (diagnostic override)" : "official PCG (not the NekoC PRNG)", ...result, diagnostics: kernel.diagnostics };
  } catch (error) {
    kernel.diagnostics.partialTrace = await kernel.page.evaluate(() => window.__k4Oracle && ({
      frames: window.__k4Oracle.frames, errors: window.__k4Oracle.errors, events: window.__k4Oracle.events,
    })).catch(() => null);
    kernel.diagnostics.lastState = await kernel.page.evaluate(() => window.__k4OracleRequire("ALsR").a.get_state()).catch(() => null);
    error.diagnostics = kernel.diagnostics;
    throw error;
  } finally { await kernel.close(); }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.input) {
    console.log("Usage: node tools/compat/k4-oracle.mjs run|compile --input work.bcm [--out output.json] [--player-dir app] [--frames 60] [--seed 1] [--channel msedge] [--allow-assets] [--blocks] [--block-filter id,id] [--random-source pcg|nekoc] [--diagnostics log.json]");
    if (!options.help) process.exitCode = 2;
    return;
  }
  if (options.command === "compile" && !options.out) throw new Error("compile requires --out (input is never overwritten implicitly)");
  try {
    const result = await runOracle(await readJson(options.input), options);
    if (options.diagnostics) await saveJson(options.diagnostics, result.diagnostics);
    const output = options.command === "compile" ? result.project : result;
    if (options.out) await saveJson(options.out, output);
    else console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    if (options.diagnostics && error.diagnostics) await saveJson(options.diagnostics, error.diagnostics);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.stack || error); process.exitCode = 1;
});
