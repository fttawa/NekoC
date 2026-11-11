#!/usr/bin/env node
// Original asset-free KN warp probes. Official code stays in ignored dist only.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadPlaywright } from "./probe-kitten4.mjs";
import { fixtures as baseFixtures, officialUrl } from "./semantics-kitten-n.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "tests/fixtures/kn-warp");
const scratch = path.join(root, "dist/kn-warp");
const sha256 = data => createHash("sha256").update(data).digest("hex");
let serial = 0;
const b = (type, fields = {}, inputs = {}, statements = {}) => ({ id: `knwarp-${++serial}`, type, fields, inputs, statements });
const n = value => b("math_number", { NUM: String(value) });
const get = variable => b("variables_get", { variable });
const set = (variable, value) => b("variables_set", { variable }, { value });
const inc = (variable = "count") => set(variable, b("math_arithmetic", { type: "add" }, { A: get(variable), B: n(1) }));
const chain = (...nodes) => { for (let i = 1; i < nodes.length; i++) nodes[i - 1].next = nodes[i]; return nodes[0]; };
const repeat = (times, body) => b("repeat_n_times", {}, { times: n(times) }, { DO: body });
const warp = body => b("warp", {}, {}, { DO: body });
const wait = () => b("wait", {}, { time: n(0) });
const start = (...body) => chain(b("on_running_group_activated"), ...body);
const call = () => ({ ...b("procedures_2_callnoreturn", { NAME: "knwarp-procedure" }), mutation: '<mutation def_id="knwarp-procedure" name="knwarp-procedure" type="NORMAL"></mutation>' });
const reporterCall = () => ({ ...b("procedures_2_callreturn", { NAME: "knwarp-procedure" }), mutation: '<mutation def_id="knwarp-procedure" name="knwarp-procedure" type="ROUND"></mutation>' });
const until = (times, body) => b("repeat_forever_until", {}, { condition: b("logic_compare", { OP: "GTE" }, { A: get("count"), B: n(times) }) }, { DO: body });
const range = (times, body) => ({ ...b("traverse_number", {}, { from: n(1), to: n(times), by: n(1), value: b("traverse_number_param", { TEXT: "i" }) }, { DO: body }), mutation: '<mutation items="2"></mutation>' });

export function fixtures() {
  serial = 0;
  const template = baseFixtures()["yield-warp"];
  const make = (name, bodies, procedure) => {
    const p = structuredClone(template), actor = Object.values(p.actors.actorsDict)[0];
    p.projectName = `NekoC KN warp ${name}`;
    actor.nekoBlockJsonList = bodies.map((body, i) => ({ ...body, location: [80 + i * 350, 100] }));
    p.variables.variablesDict = Object.fromEntries(Object.entries({ count: 0, other: 0, after: 0, done: 0, inside: 0, outside: 0 }).map(([id, value]) => [id, {
      id, name: id, value, type: "any", isGlobal: true, currentEntityId: actor.id, visible: false, position: { x: 0, y: 0 },
    }]));
    if (procedure) p.procedures.proceduresDict = { "knwarp-procedure": {
      id: "knwarp-procedure", name: "probe", type: name.startsWith("reporter") ? "ROUND" : "NORMAL", params: [],
      workspaceScrollXy: { x: 100, y: 50 }, comments: {},
      nekoBlockJsonList: [{ ...b("procedures_2_defnoreturn", { NAME: "knwarp-procedure" }, {}, { STACK: procedure }), mutation: '<mutation></mutation>', location: [80, 100] }],
    } };
    return p;
  };
  const done = () => [set("after", n(1)), set("done", n(1))];
  return {
    "boundary-30001": make("boundary-30001", [start(warp(repeat(30001, inc())), ...done())]),
    "boundary-30002": make("boundary-30002", [start(warp(repeat(30002, inc())), ...done())]),
    "boundary-30003": make("boundary-30003", [start(warp(repeat(30003, inc())), ...done())]),
    "straight-line": make("straight-line", [start(warp(chain(...Array.from({ length: 80 }, () => inc()))), ...done())]),
    "nested": make("nested", [start(warp(repeat(2, warp(repeat(15001, inc())))), ...done())]),
    "siblings": make("siblings", [start(warp(repeat(15001, inc())), warp(repeat(15001, inc())), ...done())]),
    "parallel": make("parallel", [start(warp(repeat(30003, inc())), ...done()), start(warp(repeat(30003, inc("other"))))]),
    "until": make("until", [start(warp(until(30002, inc())), ...done())]),
    "range": make("range", [start(warp(range(30002, inc())), ...done())]),
    "break": make("break", [start(warp(repeat(30003, chain(inc(), b("break")))), ...done())]),
    "procedure-in-warp": make("procedure-in-warp", [start(warp(chain(repeat(15001, inc()), call(), set("inside", n(1)))), repeat(2, inc("outside")), ...done())], repeat(15001, inc())),
    "procedure-local-warp": make("procedure-local-warp", [start(call(), repeat(2, inc("outside")), ...done())], warp(repeat(30002, inc()))),
    "procedure-wait": make("procedure-wait", [start(warp(chain(repeat(15001, inc()), call(), repeat(15001, inc()))), repeat(2, inc("outside")), ...done())], chain(wait(), repeat(15001, inc()))),
    "reporter-local-warp": make("reporter-local-warp", [start(set("inside", reporterCall()), ...done())], chain(warp(repeat(30002, inc())), { ...b("procedures_2_return_value", {}, { VALUE: get("count") }), mutation: '<mutation items="1"></mutation>', shadows: { VALUE: '<shadow type="math_number"><field name="NUM">0</field></shadow>' } })),
  };
}

// Locations plus hashes, NOT official source excerpts, are suitable for tracking.
export function sourceEvidence(bytes) {
  const s = bytes.toString("utf8");
  const terms = [
    ["default limits", "max_warp_iterations_per_interpreter_step:3e4", 95],
    ["compiled body-tail check", "t.prototype.create_iteration_yield_point=function", 212],
    ["nested warp depth", "t.prototype.enter_warp_block=function", 162],
    ["repeat body then check", "t.prototype.compile_repeat_n_times=function", 819],
    ["until body then check", "t.prototype.compile_repeat_forever_until=function", 782],
    ["range body then check", "t.prototype.compile_traverse_number=function", 2400],
    ["break skips tail", "t.prototype.compile_break=function", 676],
    ["procedure lexical warp argument", "t.prototype.compile_procedure_call=function", 774],
    ["procedure inherits frame warp", "t.prototype.step_call_procedure=function", 966],
    ["old count comparison and increment", "t.prototype.step_iteration_yield=function", 453],
    ["per interpreter step reset", "t.prototype.step=function(){this.n_warp_iterations=0", 376],
    ["manager once per interpreter", "t.prototype.step_code=function", 1220],
    ["manager update tasks and frame", "t.prototype.update=function(){var t=this;this.event_bus.runtime_manager.before_update", 2010],
    ["debug path differs", "t.prototype.eval_repeat_template=function", 1060],
    ["clock uses performance.now with Date fallback", "t.prototype._wall_clock_now=function", 229],
  ];
  return { bundle: "crc_libs.8196dbd1.js", sha256: sha256(bytes), locations: terms.map(([purpose, anchor, length]) => {
    const charOffset = s.indexOf(anchor);
    if (charOffset < 0) throw new Error(`Official source changed: ${purpose}`);
    return { purpose, charOffset, byteOffset: Buffer.byteLength(s.slice(0, charOffset)), length, excerptSha256: sha256(s.slice(charOffset, charOffset + length)) };
  }) };
}

export async function probe(page, source, mode, result) {
  result.mode = mode;
  result.method = mode === "deterministic" ? "Explicit controlled diagnostic: set config.deterministic before Start; no default-wall-clock claims" : mode === "baseline" ? "Unmodified default runtime; webpack loader exposure and passive final variables only" : "Real wall-clock default configuration; pass-through observer wrappers add overhead, NOT a throughput benchmark";
  await page.route(/\/crc_libs\.[\w-]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body();
    await fs.writeFile(path.join(scratch, path.basename(new URL(route.request().url()).pathname)), bytes);
    result.runtimeBundle = { url: route.request().url(), sha256: sha256(bytes) };
    result.sourceEvidence = sourceEvidence(bytes);
    await route.fulfill({ response, body: bytes });
  });
  await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body(), s = bytes.toString("utf8"), marker = "var __webpack_exports__=";
    if (!s.includes(marker)) throw new Error("Official loader changed");
    result.mainBundle = { url: route.request().url(), sha256: sha256(bytes) };
    await fs.writeFile(path.join(scratch, path.basename(new URL(route.request().url()).pathname)), bytes);
    await route.fulfill({ response, body: s.replace(marker, `window.__nekocRequire=__webpack_require__;${marker}`) });
  });
  const projectUrl = "https://kn.codemao.cn/__nekoc_kn_warp__.bcmkn";
  await page.route(projectUrl, route => route.fulfill({ contentType: "application/json", body: source }));
  await page.goto(`${officialUrl}?previewUrl=${encodeURIComponent(projectUrl)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") && window.__nekocRequire(91107).BcmInstance.getBcm().projectName?.startsWith("NekoC KN warp") &&
    (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
  const done = page.getByText(/^完成$/).last();
  if (await done.isVisible()) await done.dispatchEvent("click");
  result.inspection = await page.evaluate(mode => {
    const req = window.__nekocRequire, core = req(26921).cG.get_instance().getHeart().core, manager = core.get_runtime_manager().run_mgr;
    if (mode === "deterministic") core.get_util().config.get().deterministic = { seconds_per_update: 1 / 60 };
    const find = name => {
      for (const [id, factory] of Object.entries(req.m)) if (factory.toString().includes(`e.${name}=`)) {
        const exports = req(id); if (exports[name]) return exports[name];
      }
      throw new Error(`Missing official export: ${name}`);
    };
    const Runner = find("OptiRunner"), trace = window.__knWarpTrace = { steps: [], boundaries: [], renders: [], updates: [], errors: [] };
    const variables = () => Object.fromEntries(Object.keys(req(91107).BcmInstance.variablesDict).map(id => [id, manager.get_variable(id)]));
    window.__knWarpVariables = variables;
    if (mode === "baseline") return { config: core.get_util().config.get(), instrumentation: "none" };
    const originalStep = Runner.prototype.step, originalBoundary = Runner.prototype.step_iteration_yield;
    // Isolated calls to the official method, NOT a default-runtime observation.
    const boundaryDiagnostics = [
      { label: "old-30000", old: 30000, deterministic: true, lexical: true },
      { label: "old-30001", old: 30001, deterministic: true, lexical: true },
      { label: "wall-equal-4ms", old: 0, deterministic: false, lexical: true, now: 104 },
      { label: "wall-over-4ms", old: 0, deterministic: false, lexical: true, now: 104.001 },
      { label: "nonwarp-no-increment", old: 9, deterministic: true, lexical: false },
      { label: "inherited-warp", old: 30001, deterministic: true, lexical: false, frameWarp: true },
    ].map(input => {
      let wallCalls = 0;
      const context = { current_frame: { is_warped: input.frameWarp ?? false }, n_warp_iterations: input.old,
        max_warp_iterations_per_interpreter_step: 30000, deterministic_mode: input.deterministic,
        warp_tick_start: 100, warp_interpreter_millisecond_time_limit: 4,
        run_mgr: { wall_clock_now() { wallCalls++; return input.now; } } };
      const answer = originalBoundary.call(context, input.lexical);
      return { ...input, answer, newCount: context.n_warp_iterations, wallCalls };
    });
    let activeStep;
    Runner.prototype.step = function(...args) {
      const entry = { id: this.metadata.interpreter_id, frame: manager.frames, at: performance.now(), before: variables(), countBeforeReset: this.n_warp_iterations, calls: 0, warpedCalls: 0, procedureFrames: [] };
      activeStep = entry;
      const result = originalStep.apply(this, args);
      Object.assign(entry, { result, after: variables(), countAfter: this.n_warp_iterations, endAt: performance.now(), stackDepth: this.program_state.proc_stack.length, deterministic: this.deterministic_mode });
      trace.steps.push(entry); activeStep = undefined;
      return result;
    };
    Runner.prototype.step_iteration_yield = function(...args) {
      const oldCount = this.n_warp_iterations, warped = !!(args[0] || this.current_frame.is_warped), proc = this.current_frame.proc_id;
      if (activeStep) { activeStep.calls++; if (warped) activeStep.warpedCalls++; if (!activeStep.procedureFrames.includes(`${proc}:${this.current_frame.is_warped}`)) activeStep.procedureFrames.push(`${proc}:${this.current_frame.is_warped}`); }
      const answer = originalBoundary.apply(this, args);
      if (answer || (warped && oldCount >= 29999)) trace.boundaries.push({ frame: manager.frames, id: this.metadata.interpreter_id, oldCount, newCount: this.n_warp_iterations, warped, lexicalWarp: args[0], frameWarp: this.current_frame.is_warped, proc, answer, variables: variables() });
      return answer;
    };
    const originalUpdate = manager.update;
    manager.update = function(...args) {
      const before = this.frames, result = originalUpdate.apply(this, args);
      if (this.frames !== before && trace.updates.length < 120) trace.updates.push({ before, after: this.frames, variables: variables() });
      return result;
    };
    const stage = req(54174).V;
    const renderer = stage.core.app.get_app().renderer, originalRender = renderer.render;
    if (originalRender) renderer.render = function(...args) {
      if (trace.renders.length < 500) trace.renders.push({ frame: manager.frames, at: performance.now(), variables: variables() });
      return originalRender.apply(this, args);
    };
    // Inspect rather than guess rendering surface names; later versions can differ.
    const describe = obj => ({ own: Object.keys(obj), prototype: Object.getOwnPropertyNames(Object.getPrototypeOf(obj)) });
    window.__knWarpVariables = variables;
    return { config: core.get_util().config.get(), runner: Runner.name, manager: describe(manager), stage: describe(stage), stageCore: describe(stage.core), app: describe(stage.core.app), renderer: describe(renderer), boundaryDiagnostics };
  }, mode);
  await page.getByText(/^开始$/).last().dispatchEvent("click");
  await page.waitForFunction(() => {
    const variables = window.__knWarpVariables();
    return variables.done === 1 && (!window.__nekocRequire(91107).BcmInstance.getBcm().projectName.endsWith(" parallel") || variables.other === 30003);
  }, null, { timeout: 30000 });
  await page.waitForTimeout(120);
  Object.assign(result, await page.evaluate(() => ({ ...window.__knWarpTrace, variables: window.__knWarpVariables(), projectVersion: window.__nekocRequire(91107).BcmInstance.getBcm().version })));
}

const sameVariables = (a, b) => !!a && !!b && JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export function validateObservation(name, observation) {
  const [caseName, mode] = name.split("/");
  if (observation.fixture !== `tests/fixtures/kn-warp/${caseName}.bcmkn` || observation.mode !== mode || observation.error || !Array.isArray(observation.pageErrors) || observation.pageErrors.length || observation.variables?.done !== 1) throw new Error(`Invalid observation ${name}`);
  if (!observation.runtimeBundle?.sha256 || !observation.mainBundle?.sha256 || observation.sourceEvidence?.sha256 !== observation.runtimeBundle.sha256 || !observation.sourceEvidence.locations?.length || !observation.inspection?.config) throw new Error(`Missing source identity ${name}`);
  if (!Array.isArray(observation.steps) || !observation.steps.length || !observation.steps.every(s => s.deterministic === (mode === "deterministic")) || !sameVariables(observation.steps.at(-1).after, observation.variables)) throw new Error(`Incomplete step trace ${name}`);
  if (!observation.updates?.length || (!observation.updates.some(u => sameVariables(u.variables, observation.variables)) && observation.updates.length !== 120)) throw new Error(`Incomplete update trace ${name}`);
  if (caseName === "parallel" && observation.variables.other !== 30003) throw new Error("Incomplete parallel interpreter");
}

export function validateBaseline(baseline, reference) {
  const value = baseline.cases?.["reporter-local-warp/baseline"];
  if (!baseline.ok || value?.mode !== "baseline" || value.inspection?.instrumentation !== "none" || value.fixture !== reference.fixture || value.sha256 !== reference.sha256 || value.error || !Array.isArray(value.pageErrors) || value.pageErrors.length || !sameVariables(value.variables, reference.variables)) throw new Error("Missing/stale uninstrumented reporter baseline");
}

// Archive-only reduction. Keep raw reports, all steps, failures and local comparisons.
export function compactObservation(observation) {
  const result = structuredClone(observation);
  if (result.inspection) {
    const { config, boundaryDiagnostics, instrumentation } = result.inspection;
    result.inspection = { config, ...(boundaryDiagnostics ? { boundaryDiagnostics } : {}), ...(instrumentation ? { instrumentation } : {}) };
  }
  const originalUpdates = result.updates?.length ?? 0, originalRenders = result.renders?.length ?? 0;
  if (result.updates) {
    const completed = result.updates.findIndex(sample => sample.variables?.done === 1);
    if (completed >= 0) result.updates = result.updates.slice(0, completed + 2);
  }
  if (result.renders) {
    let previous;
    result.renders = result.renders.filter(sample => {
      const state = JSON.stringify(sample.variables);
      if (state === previous) return false;
      previous = state;
      return true;
    });
  }
  result.archiveSampling = {
    steps: "All recorded steps retained unchanged",
    updates: "Through first done=1 sample plus at most one following sample; raw probe caps at 120",
    renders: "First sample of each consecutive identical variables run; raw probe caps at 500",
    originalUpdates, retainedUpdates: result.updates?.length ?? 0,
    originalRenders, retainedRenders: result.renders?.length ?? 0,
  };
  return result;
}

async function main() {
  const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
  const cases = fixtures();
  await fs.mkdir(scratch, { recursive: true });
  if (option("--archive")) {
    const report = JSON.parse(await fs.readFile(option("--archive"), "utf8"));
    const editorCompat = JSON.parse(await fs.readFile(path.join(scratch, "editor-compat.json"), "utf8"));
    const expectedKeys = Object.keys(cases).flatMap(name => ["default", "deterministic"].map(mode => `${name}/${mode}`)).sort();
    if (!report.ok || !editorCompat.ok || JSON.stringify(Object.keys(report.cases).sort()) !== JSON.stringify(expectedKeys) || editorCompat.projects.length !== Object.keys(cases).length) throw new Error("Incomplete official/editor observations");
    for (const p of editorCompat.projects) p.input = path.relative(root, p.input).replaceAll("\\", "/");
    for (const [name, observation] of Object.entries(report.cases)) {
      validateObservation(name, observation);
      const bytes = await fs.readFile(path.join(root, observation.fixture));
      if (sha256(bytes) !== observation.sha256 || !editorCompat.projects.some(p => p.input === observation.fixture && p.sha256 === observation.sha256 && p.ok && Array.isArray(p.issues) && !p.issues.length && Array.isArray(p.pageErrors) && !p.pageErrors.length)) throw new Error(`Stale fixture/editor check ${name}`);
    }
    const baseline = JSON.parse(await fs.readFile(path.join(scratch, "baseline.json"), "utf8"));
    validateBaseline(baseline, report.cases["reporter-local-warp/default"]);
    const archive = { schema: "nekoc-kn-warp-official-v1", ...report,
      cases: Object.fromEntries(Object.entries(report.cases).map(([name, observation]) => [name, compactObservation(observation)])),
      rawReport: { path: path.relative(root, path.resolve(option("--archive"))).replaceAll("\\", "/"), sha256: sha256(await fs.readFile(option("--archive"))) },
      editorCompat, baseline: { ...baseline, cases: Object.fromEntries(Object.entries(baseline.cases).map(([name, observation]) => [name, compactObservation(observation)])) },
      limitations: ["Default observer overhead changes wall-clock cut positions; not a speed benchmark", "Explicit deterministic config is controlled diagnosis, not default editor behavior", "Renderer calls do not prove pixels or display presentation", "Native continue not present in official compiler; TypeScript continue lowering not live-tested", "DebugRunner source differs; debug execution not tested", "Reporter cross-update resume is official behavior; synchronous local reporters remain a compatibility risk", "Local final-value comparison is not a scheduling equivalence proof"] };
    await fs.writeFile(path.join(root, "docs/kn-warp-official.json"), JSON.stringify(archive, null, 2) + "\n");
    return;
  }
  if (process.argv.includes("--generate")) {
    await fs.mkdir(directory, { recursive: true });
    for (const [name, p] of Object.entries(cases)) await fs.writeFile(path.join(directory, `${name}.bcmkn`), JSON.stringify(p, null, 2) + "\n");
    return;
  }
  const selected = option("--case") ? [option("--case")] : Object.keys(cases);
  const modes = option("--mode") ? [option("--mode")] : ["default", "deterministic"];
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  const report = { officialUrl, verifiedAt: new Date().toISOString(), browserVersion: browser.version(), cases: {} };
  try {
    for (const name of selected) for (const mode of modes) {
      if (!cases[name] || !["default", "deterministic", "baseline"].includes(mode)) throw new Error("Unknown case/mode");
      const page = await browser.newPage(), result = report.cases[`${name}/${mode}`] = { pageErrors: [] };
      page.on("pageerror", e => result.pageErrors.push(String(e)));
      try {
        const filename = path.join(directory, `${name}.bcmkn`), source = await fs.readFile(filename, "utf8");
        Object.assign(result, { fixture: path.relative(root, filename).replaceAll("\\", "/"), sha256: sha256(source) });
        await probe(page, source, mode, result);
        if (option("--nekoc")) {
          const run = spawnSync(path.resolve(option("--nekoc")), [filename], { encoding: "utf8", timeout: 30000 });
          result.nekoc = run.status === 0 ? JSON.parse(run.stdout) : { error: run.stderr || String(run.error), status: run.status };
          result.finalVariablesEqual = !!result.nekoc.variables && JSON.stringify(Object.entries(result.variables).sort()) === JSON.stringify(Object.entries(result.nekoc.variables).sort());
        }
      } catch (e) { result.error = String(e); }
      finally { await page.close(); }
      console.log(JSON.stringify({ name, mode, error: result.error, pageErrors: result.pageErrors, variables: result.variables, stepCount: result.steps?.length, firstSteps: result.steps?.slice(0, 4).map(s => ({ frame: s.frame, after: s.after, calls: s.calls, count: s.countAfter })) }));
      await fs.writeFile(option("--out") ?? path.join(scratch, "report.json"), JSON.stringify(report, null, 2) + "\n");
    }
  } finally { await browser.close(); }
  report.ok = Object.values(report.cases).every(r => !r.error && !r.pageErrors.length && r.variables?.done === 1);
  await fs.writeFile(option("--out") ?? path.join(scratch, "report.json"), JSON.stringify(report, null, 2) + "\n");
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
