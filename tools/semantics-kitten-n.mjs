#!/usr/bin/env node
// Original, asset-free KN probes. Official bundles are never checked in.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./probe-kitten4.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "tests/fixtures/kn-semantics");
export const officialUrl = "https://kn.codemao.cn/editor";
const actor = "20000000-0000-4000-8000-000000000001";
const template = JSON.parse(await readFile(path.join(root, "samples/kitten-n-0.27.4.bcmkn"), "utf8"));
let serial = 0;
const b = (type, fields = {}, inputs = {}, statements = {}) => ({ id: `knsem-${++serial}`, type, fields, inputs, statements });
const n = value => b("math_number", { NUM: String(value) });
const text = value => b("text", { TEXT: value });
const get = variable => b("variables_get", { variable });
const set = (variable, value) => b("variables_set", { variable }, { value });
const chain = (...nodes) => { for (let i = 1; i < nodes.length; i++) nodes[i - 1].next = nodes[i]; return nodes[0]; };
const start = (...nodes) => chain(b("on_running_group_activated"), ...nodes);
const wait = value => b("wait", {}, { time: n(value) });
const join = (...nodes) => ({ ...b("text_join", {}, Object.fromEntries(nodes.map((v, i) => [`ADD${i}`, v]))), mutation: `<mutation items="${nodes.length}"></mutation>` });
const log = value => set("trace", join(get("trace"), text(value)));
const repeat = (times, body) => b("repeat_n_times", {}, { times: n(times) }, { DO: body });
const send = sync => b(sync ? "self_broadcast_and_wait" : "self_broadcast", {}, { message: text("probe") });
const listen = (...nodes) => b("self_listen", {}, { message: text("probe") }, { DO: chain(...nodes) });
const convert = (value, type = "number") => b("convert_type", { type }, { text: value });
const list = () => b("pure_list_get", { list: "items" });

function project(name, roots, values = {}) {
  const p = structuredClone(template), scene = p.scenes.currentSceneId;
  p.projectName = `NekoC KN semantics ${name}`;
  p.actors.actorsDict = { [actor]: { ...Object.values(p.actors.actorsDict)[0], id: actor, sceneId: scene, nekoBlockJsonList: roots } };
  p.scenes.scenesDict[scene].actorIds = [actor];
  p.variables.variablesDict = Object.fromEntries(Object.entries({ trace: "", done: 0, ...values }).map(([id, value]) => [id, {
    id, name: id, value, type: Array.isArray(value) ? "list" : "any", isGlobal: true, currentEntityId: actor, visible: false, position: { x: 0, y: 0 },
  }]));
  return p;
}

export function fixtures() {
  serial = 0;
  const cases = {
    scheduling: project("scheduling", [start(log("A"), wait(0), log("a"), set("done", n(1))), start(log("B"), wait(0), log("b"))]),
    broadcast: project("broadcast", [start(log("A"), send(false), log("B"), wait(0.2), log("C"), set("done", n(1))), listen(log("R"), wait(0), log("r"))]),
    "broadcast-wait": project("broadcast-wait", [start(log("A"), send(true), log("B"), set("done", n(1))), listen(log("R"), wait(0), log("r"))]),
    clone: project("clone", [start(log("A"), b("mirror", { sprite: "--self" }), log("B"), wait(0.2), send(false), wait(0.2), set("done", n(1))), b("start_as_a_mirror", {}, {}, { DO: chain(log("K"), wait(0), log("k")) }), listen(set("trace", join(get("trace"), convert(b("get_current_clone_index"), "string"))))]),
    yield: project("yield", [start(repeat(3, log("A")), log("a"), set("done", n(1))), start(repeat(3, log("B")), log("b"))]),
    "yield-warp": project("yield-warp", [start(b("warp", {}, {}, { DO: repeat(3, log("A")) }), log("a"), set("done", n(1))), start(repeat(3, log("B")), log("b"))]),
    "wait-negative": project("wait-negative", [start(log("A"), wait(-1), log("a"), set("done", n(1))), start(log("B"), wait(0), log("b"))]),
    "conversion-boolean": project("conversion-boolean", [start(set("trueNumber", convert(b("logic_boolean", { BOOL: "true" }))), set("falseNumber", convert(b("logic_boolean", { BOOL: "false" }))), set("done", n(1)))], { trueNumber: 0, falseNumber: 0 }),
    conversion: project("conversion", [start(...["", "  ", "0x10", "0b11", "1e2", "bad", "NaN", "Infinity"].map((s, i) => set(`v${i}`, convert(text(s)))), set("booleanNumber", convert(b("logic_boolean", { BOOL: "true" }))), set("joined", join(n(1e21), text("|"), b("logic_boolean", { BOOL: "true" }), text("|"), list())), set("done", n(1)))], { ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`v${i}`, 0])), booleanNumber: 0, joined: "", items: [1, "猫", [2, 3]] }),
    list: project("list", [start(...[1, -1, 0, 4, 1.5, -4].map((index, i) => set(`v${i}`, b("list_item", { item: "any" }, { list: list(), list_index: n(index) }))), set("done", n(1)))], { items: [10, 20, 30], ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`v${i}`, 0])) }),
  };
  return cases;
}

// Preserve non-finite numbers distinctly from JSON null and the string "NaN".
export function encodeValue(value) {
  if (value === undefined) return { $undefined: true };
  if (typeof value === "number" && !Number.isFinite(value)) return { $number: String(value) };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeValue(v)]));
  return value;
}

export function matchingVariables(official, nekoc) {
  return !!official && !!nekoc && typeof official === "object" && typeof nekoc === "object" &&
    !Array.isArray(official) && !Array.isArray(nekoc) && official.done === 1 && nekoc.done === 1 &&
    Object.keys(official).length === Object.keys(nekoc).length &&
    Object.entries(official).every(([id, value]) => Object.hasOwn(nekoc, id) && JSON.stringify(value) === JSON.stringify(nekoc[id]));
}

export function validateObservation(result, project) {
  if (result.error || !Array.isArray(result.pageErrors) || result.pageErrors.length || result.equal !== true ||
      !matchingVariables(result.variables, result.nekoc?.variables)) throw new Error("Failed or unpaired observation");
  if (!result.runtimeBundle?.sha256 || !result.mainBundle?.sha256) throw new Error("Missing official bundle identity");
  const expected = Object.keys(project.variables.variablesDict).sort();
  if (JSON.stringify(Object.keys(result.variables).sort()) !== JSON.stringify(expected)) throw new Error("Incomplete variable observation");
}

export function matchingEditorCheck(project, result) {
  return project.input === result.fixture && project.sha256 === result.sha256 && project.ok === true &&
    Array.isArray(project.issues) && !project.issues.length && Array.isArray(project.pageErrors) && !project.pageErrors.length;
}

export async function probe(page, source, result) {
  await page.route(/\/crc_libs\.[\w-]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), body = await response.body();
    result.runtimeBundle = { url: route.request().url(), sha256: createHash("sha256").update(body).digest("hex") };
    await route.fulfill({ response, body });
  });
  await page.route(/\/main\.[\w-]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), body = await response.text(), marker = "var __webpack_exports__=";
    if (!body.includes(marker)) throw new Error("Official webpack loader changed");
    result.mainBundle = { url: route.request().url(), sha256: createHash("sha256").update(body).digest("hex") };
    await route.fulfill({ response, body: body.replace(marker, `window.__nekocRequire=__webpack_require__;${marker}`) });
  });
  const projectUrl = "https://kn.codemao.cn/__nekoc_kn_semantics__.bcmkn";
  await page.route(projectUrl, route => route.fulfill({ contentType: "application/json", body: source }));
  await page.goto(`${officialUrl}?previewUrl=${encodeURIComponent(projectUrl)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") &&
    (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire(91107).BcmInstance.getBcm().projectName.startsWith("NekoC KN semantics"));
  await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
  const done = page.getByText(/^完成$/).last();
  if (await done.isVisible()) await done.dispatchEvent("click");
  await page.getByText(/^开始$/).last().dispatchEvent("click");
  await page.waitForFunction(() => {
    const manager = window.__nekocRequire(26921).cG.get_instance().getHeart().core.get_runtime_manager();
    return manager.get_variable("done") === 1;
  }, null, { timeout: 10000 });
  // Allow the second parallel script to finish, without equating wall time to frames.
  await page.waitForTimeout(150);
  result.variables = await page.evaluate(() => {
    const req = window.__nekocRequire, manager = req(26921).cG.get_instance().getHeart().core.get_runtime_manager();
    const encode = value => value === undefined ? { $undefined: true } : typeof value === "number" && !Number.isFinite(value) ? { $number: String(value) } : Array.isArray(value) ? value.map(encode) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) : value;
    return Object.fromEntries(Object.entries(req(91107).BcmInstance.variablesDict).map(([id, v]) => [id, encode(manager.get_variable(id, undefined, v.currentEntityId))]));
  });
  result.scripts = await page.evaluate(() => [...document.scripts].map(s => s.src).filter(Boolean));
}

async function main() {
  const cases = fixtures();
  if (process.argv.includes("objects")) cases.objects = JSON.parse(await readFile(path.join(directory, "objects.bcmkn"), "utf8"));
  if (process.argv.includes("object-json")) cases["object-json"] = JSON.parse(await readFile(path.join(directory, "object-json.bcmkn"), "utf8"));
  if (process.argv.includes("--generate")) {
    await mkdir(directory, { recursive: true });
    const selected = process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : null;
    for (const [name, p] of Object.entries(cases)) if (!selected || selected === name) await writeFile(path.join(directory, `${name}.bcmkn`), JSON.stringify(p, null, 2) + "\n");
    return;
  }
  const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
  if (option("--archive")) {
    const report = JSON.parse(await readFile(option("--archive"), "utf8"));
    const editorCompat = JSON.parse(await readFile(path.join(root, "dist/kn-semantics/editor-compat.json"), "utf8"));
    if (!report.ok || !editorCompat.ok || Object.keys(report.cases).length !== Object.keys(cases).length) throw new Error("Refuse to archive incomplete/failed observations");
    for (const [name, result] of Object.entries(report.cases)) {
      if (!Object.hasOwn(cases, name)) throw new Error(`Unknown observation: ${name}`);
      const bytes = await readFile(path.join(directory, `${name}.bcmkn`));
      validateObservation(result, JSON.parse(bytes.toString("utf8")));
      if (createHash("sha256").update(bytes).digest("hex") !== result.sha256 || result.fixture !== `tests/fixtures/kn-semantics/${name}.bcmkn`) throw new Error(`Stale observation: ${name}`);
    }
    for (const p of editorCompat.projects) p.input = path.relative(root, p.input).replaceAll("\\", "/");
    if (editorCompat.projects.length !== Object.keys(cases).length) throw new Error("Incomplete editor compatibility check");
    for (const result of Object.values(report.cases)) if (!editorCompat.projects.some(p => matchingEditorCheck(p, result))) throw new Error(`Missing or stale editor check: ${result.fixture}`);
    await writeFile(path.join(root, "docs/kn-semantics-official.json"), JSON.stringify({ ...report, editorCompat }, null, 2) + "\n");
    return;
  }
  const out = option("--out");
  if (!out) throw new Error("Usage: semantics-kitten-n.mjs --generate | --out report.json [--case name] [--nekoc target/debug/kn-trace.exe]");
  const selected = option("--case") ? [option("--case")] : Object.keys(cases);
  for (const name of selected) if (!cases[name]) throw new Error(`Unknown case: ${name}`);
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  const report = { officialUrl, verifiedAt: new Date().toISOString(), browserVersion: browser.version(), cases: {} };
  try {
    for (const name of selected) {
      const page = await browser.newPage();
      const result = report.cases[name] = { pageErrors: [] };
      page.on("pageerror", e => result.pageErrors.push(String(e)));
      try {
        const filename = path.join(directory, `${name}.bcmkn`), source = await readFile(filename, "utf8");
        result.fixture = path.relative(root, filename).replaceAll("\\", "/");
        result.sha256 = createHash("sha256").update(source).digest("hex");
        await probe(page, source, result);
        if (option("--nekoc")) {
          const run = spawnSync(path.resolve(option("--nekoc")), [filename], { encoding: "utf8", timeout: 30000 });
          if (run.status !== 0) throw new Error(run.stderr || String(run.error));
          result.nekoc = JSON.parse(run.stdout);
          result.equal = matchingVariables(result.variables, result.nekoc.variables);
        }
      } catch (error) { result.error = String(error); }
      finally { await page.close(); }
      console.log(JSON.stringify({ name, ...result }));
    }
  } finally { await browser.close(); }
  report.ok = Object.values(report.cases).every(r => r.variables && !r.error && !r.pageErrors.length && r.equal !== false);
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exitCode = 1; });
