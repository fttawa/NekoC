#!/usr/bin/env node
// Original projects and observations only; no official/third-party source bodies.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures, probe, matchingVariables, matchingEditorCheck, validateObservation, officialUrl } from "../semantics-kitten-n.mjs";
import { loadPlaywright } from "../probe-kitten4.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const fixturePath = name => `tests/fixtures/kn-semantics/partial2-timers-${name}.bcmkn`;
export const names = ["main", "clear"];

export function timerProjects() {
  let serial = 0;
  const b = (type, fields = {}, inputs = {}) => ({ id: `knp2t-${++serial}`, type, fields, inputs });
  const n = value => b("math_number", { NUM: String(value) });
  const get = variable => b("variables_get", { variable });
  const set = (variable, value) => b("variables_set", { variable }, { value });
  const chain = nodes => { for (let i = 1; i < nodes.length; i++) nodes[i - 1].next = nodes[i]; return nodes[0]; };
  const timer = (type, delay) => b(type, {}, { delay, callback: set("callback_hits", n(1)) });
  const clear = (type, value) => b(type, {}, { [type === "clearTimeout" ? "timeoutId" : "intervalId"]: value });
  const cases = {};
  for (const name of names) {
    const p = structuredClone(fixtures().conversion);
    p.projectName = `NekoC KN semantics partial2-timers ${name}`;
    const actor = Object.values(p.actors.actorsDict)[0];
    const body = [b("on_running_group_activated"), set("before", n(1))];
    if (name === "main") {
      for (const type of ["setTimeout", "setInterval"]) {
        for (const delay of [0, 20, 150]) body.push(timer(type, n(delay)));
        body.push(timer(type, get("text_delay")));
      }
    } else {
      // Timer blocks have no output socket. Do not pretend native projects can
      // capture browser handles. Valid-handle cancellation is tested separately.
      body.push(timer("setTimeout", n(20)), timer("setInterval", n(20)));
      for (const type of ["clearTimeout", "clearInterval"]) {
        for (const id of [0, 999999999]) body.push(clear(type, n(id)));
        body.push(clear(type, get("text_id")));
      }
    }
    body.push(set("after", n(1)), b("wait", {}, { time: n(0.35) }), set("done", n(1)));
    actor.nekoBlockJsonList = [chain(body)];
    const base = structuredClone(p.variables.variablesDict.done);
    p.variables.variablesDict = Object.fromEntries(Object.entries({ before: 0, after: 0, callback_hits: 0, done: 0, text_delay: "25", text_id: "999999999" }).map(([id, value]) => [id, { ...base, id, name: id, type: "any", value }]));
    cases[name] = p;
  }
  return cases;
}

async function domainCalls(page) {
  return page.evaluate(async () => {
    const req = window.__nekocRequire;
    const registry = req(26921).cG.get_instance().getHeart().core.get_registry();
    const actor = Object.keys(req(91107).BcmInstance.getBcm().actors.actorsDict)[0];
    const call = (type, args) => registry.domain_function_list[registry.get_domain_function_index(type)](args, "probe", actor, actor, "probe", {});
    const encode = value => value === undefined ? { $undefined: true } : value;
    const pause = ms => new Promise(resolve => window.setTimeout(resolve, ms));
    const rows = [];
    let timeout = 0, interval = 0;
    const t = call("setTimeout", { callback: () => timeout++, delay: 20 });
    const i = call("setInterval", { callback: () => interval++, delay: 20 });
    await pause(160);
    const intervalBeforeClear = interval;
    const result = call("clearInterval", { intervalId: i });
    await pause(80);
    rows.push({ label: "functions-fire", timeoutId: t, intervalId: i, timeout, intervalBeforeClear, intervalAfterClear: interval, clearResult: encode(result) });
    for (const [label, register, cancel, socket] of [
      ["timeout-clearTimeout", "setTimeout", "clearTimeout", "timeoutId"],
      ["interval-clearInterval", "setInterval", "clearInterval", "intervalId"],
      ["timeout-clearInterval", "setTimeout", "clearInterval", "intervalId"],
      ["interval-clearTimeout", "setInterval", "clearTimeout", "timeoutId"],
    ]) {
      let fired = 0;
      const id = call(register, { callback: () => fired++, delay: 40 });
      const clearResult = call(cancel, { [socket]: id });
      await pause(100);
      rows.push({ label, register, cancel, socket, id, fired, clearResult: encode(clearResult) });
      // Cleanup is redundant when the observation passes, but safe on failure.
      call("clearTimeout", { timeoutId: id });
    }
    for (const type of ["setTimeout", "setInterval"]) {
      window.__knPartial2TextExecuted = false;
      const id = call(type, { callback: "window.__knPartial2TextExecuted = true", delay: 5 });
      await pause(40);
      call("clearTimeout", { timeoutId: id });
      rows.push({ label: `${type}-text-not-eval`, id, executed: window.__knPartial2TextExecuted });
    }
    return { editorVersion: req(91107).BcmInstance.getBcm().version, rows };
  });
}

async function nativeCallObservation(page) {
  // A separate second native Start, with passive, forwarding registry wrappers.
  await page.getByText(/^停止$/).last().dispatchEvent("click");
  await page.getByText(/^开始$/).last().waitFor();
  await page.evaluate(() => {
    const registry = window.__nekocRequire(26921).cG.get_instance().getHeart().core.get_registry();
    window.__knPartial2Calls = [];
    for (const type of ["setTimeout", "setInterval", "clearTimeout", "clearInterval"]) {
      const index = registry.get_domain_function_index(type), original = registry.domain_function_list[index];
      registry.domain_function_list[index] = function(args, ...rest) {
        const result = original.call(this, args, ...rest);
        window.__knPartial2Calls.push({ type, keys: Object.keys(args), callbackType: typeof args.callback,
          ...(Object.hasOwn(args, "delay") ? { delay: args.delay } : {}),
          ...(Object.hasOwn(args, "timeoutId") ? { timeoutId: args.timeoutId } : {}),
          ...(Object.hasOwn(args, "intervalId") ? { intervalId: args.intervalId } : {}),
          result: result === undefined ? { $undefined: true } : result });
        return result;
      };
    }
  });
  await page.getByText(/^开始$/).last().dispatchEvent("click");
  await page.waitForTimeout(700);
  return page.evaluate(() => ({ calls: window.__knPartial2Calls, callbackHits: window.__nekocRequire(26921).cG.get_instance().getHeart().core.get_runtime_manager().get_variable("callback_hits") }));
}

function checkDomain(local) {
  if (local?.editorVersion !== "0.27.4" || local.rows?.length !== 7) throw new Error("Incomplete timer domain observations");
  const [fire, ...rows] = local.rows;
  if (fire.label !== "functions-fire" || fire.timeout !== 1 || fire.intervalBeforeClear < 1 || fire.intervalAfterClear !== fire.intervalBeforeClear || fire.clearResult?.$undefined !== true || !Number.isSafeInteger(fire.timeoutId) || !Number.isSafeInteger(fire.intervalId)) throw new Error("Unverified live function callbacks");
  for (const [index, label] of ["timeout-clearTimeout", "interval-clearInterval", "timeout-clearInterval", "interval-clearTimeout"].entries()) {
    const row = rows[index];
    const [register, cancel] = label.split("-");
    if (row.label !== label || row.register !== (register === "timeout" ? "setTimeout" : "setInterval") || row.cancel !== cancel || row.socket !== (cancel === "clearTimeout" ? "timeoutId" : "intervalId") || !Number.isSafeInteger(row.id) || row.id < 1 || row.fired !== 0 || row.clearResult?.$undefined !== true) throw new Error("Unverified valid-handle cancellation");
  }
  for (const [index, type] of ["setTimeout", "setInterval"].entries()) {
    const row = rows[index + 4];
    if (row.label !== `${type}-text-not-eval` || !Number.isSafeInteger(row.id) || row.executed !== false) throw new Error("Unverified nonfunction callback");
  }
}

export async function validateArchive(report) {
  if (!report.ok || !report.editorCompat?.ok || report.editorCompat.projects?.length !== 2 || !/^[a-f0-9]{64}$/.test(report.nekocBinary?.sha256 ?? "") || !report.nekocBinary?.path || !Number.isFinite(Date.parse(report.verifiedAt)) || Object.keys(report.cases ?? {}).sort().join() !== [...names].sort().join()) throw new Error("Refuse incomplete timer archive");
  checkDomain(report.domain);
  for (const [name, project] of Object.entries(timerProjects())) {
    const result = report.cases[name];
    const source = await readFile(path.join(root, fixturePath(name)), "utf8");
    if (source !== JSON.stringify(project, null, 2) + "\n" || result.fixture !== fixturePath(name) || hash(source) !== result.sha256) throw new Error("Stale timer fixture");
    validateObservation(result, project);
    const expectedVariables = { before: 1, after: 1, callback_hits: 0, done: 1, text_delay: "25", text_id: "999999999" };
    if (!matchingVariables(expectedVariables, result.variables)) throw new Error("Changed native timer results");
    if (!report.editorCompat.projects.some(p => p.editorVersion === "0.27.4" && matchingEditorCheck(p, result))) throw new Error("Missing matching timer editor check");
    const calls = result.nativeObservation?.calls;
    if (result.nativeObservation?.callbackHits !== 0 || calls?.length !== 8) throw new Error("Incomplete native call observation");
    const expectedTypes = name === "main" ? [...Array(4).fill("setTimeout"), ...Array(4).fill("setInterval")] : ["setTimeout", "setInterval", ...Array(3).fill("clearTimeout"), ...Array(3).fill("clearInterval")];
    if (JSON.stringify(calls.map(c => c.type)) !== JSON.stringify(expectedTypes)) throw new Error("Missing native timer type");
    const sets = calls.filter(c => ["setTimeout", "setInterval"].includes(c.type));
    if (JSON.stringify(sets.map(c => c.delay)) !== JSON.stringify(name === "main" ? [0, 20, 150, "25", 0, 20, 150, "25"] : [20, 20])) throw new Error("Changed native timer delay");
    for (const type of ["clearTimeout", "clearInterval"]) {
      const clears = calls.filter(c => c.type === type), socket = type === "clearTimeout" ? "timeoutId" : "intervalId";
      if (name === "clear" && (JSON.stringify(clears.map(c => c[socket])) !== JSON.stringify([0, 999999999, "999999999"]) || !clears.every(c => c.keys.join() === socket && c.result?.$undefined === true))) throw new Error("Changed native timer cancellation");
    }
    for (const c of calls.filter(c => ["setTimeout", "setInterval"].includes(c.type))) {
      if (c.callbackType !== "undefined" || c.keys.join() !== "delay" || !Number.isSafeInteger(c.result)) throw new Error("Native callback contract changed");
    }
  }
}

async function main() {
  const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
  if (process.argv.includes("--generate")) {
    for (const [name, project] of Object.entries(timerProjects())) await writeFile(path.join(root, fixturePath(name)), JSON.stringify(project, null, 2) + "\n");
    return;
  }
  if (option("--archive")) {
    const report = JSON.parse(await readFile(option("--archive"), "utf8"));
    report.editorCompat = JSON.parse(await readFile(option("--editor-check"), "utf8"));
    for (const p of report.editorCompat.projects) p.input = path.relative(root, path.resolve(p.input)).replaceAll("\\", "/");
    await validateArchive(report);
    await writeFile(path.join(root, "docs/kn-partial2-timers-official.json"), JSON.stringify(report, null, 2) + "\n");
    return;
  }
  const out = option("--out") ?? "dist/kn-partial2-timers/report.json";
  const binary = path.resolve(option("--nekoc") ?? path.join(root, "target/debug/kn-trace.exe"));
  const report = { officialUrl, verifiedAt: new Date().toISOString(), nekocBinary: { path: binary, sha256: hash(await readFile(binary)) }, cases: {} };
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  report.browserVersion = browser.version();
  try {
    for (const name of names) {
      const source = await readFile(path.join(root, fixturePath(name)), "utf8");
      const result = report.cases[name] = { fixture: fixturePath(name), sha256: hash(source), pageErrors: [] };
      const page = await browser.newPage();
      page.on("pageerror", error => result.pageErrors.push(String(error)));
      try {
        await probe(page, source, result);
        const run = spawnSync(binary, [path.join(root, fixturePath(name))], { encoding: "utf8", timeout: 30000 });
        if (run.status !== 0) throw new Error(run.stderr || String(run.error));
        result.nekoc = JSON.parse(run.stdout);
        result.equal = matchingVariables(result.variables, result.nekoc.variables);
        if (name === "main") report.domain = await domainCalls(page);
        result.nativeObservation = await nativeCallObservation(page);
        validateObservation(result, JSON.parse(source));
      } catch (error) { result.error = String(error); }
      finally { await page.close(); }
    }
  } finally { await browser.close(); }
  if (hash(await readFile(binary)) !== report.nekocBinary.sha256) throw new Error("Trace binary changed during pairing; rerun with a stable build");
  report.ok = names.every(name => report.cases[name].equal && !report.cases[name].error && !report.cases[name].pageErrors.length);
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
