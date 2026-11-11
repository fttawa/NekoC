#!/usr/bin/env node
// Original, asset-free probes. Reuses the KN oracle's template and typed encoding.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures as baseFixtures, officialUrl, matchingVariables, probe } from "./semantics-kitten-n.mjs";
import { loadPlaywright } from "./probe-kitten4.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "tests/fixtures/kn-value-types");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export function fixtures() {
  let serial = 0;
  const b = (type, fields = {}, inputs = {}) => ({ id: `knvt-${++serial}`, type, fields, inputs });
  const n = value => b("math_number", { NUM: String(value) });
  const text = value => b("text", { TEXT: value });
  const get = variable => b("variables_get", { variable });
  const list = id => b("pure_list_get", { list: id });
  const set = (variable, value) => b("variables_set", { variable }, { value });
  const convert = (value, type) => b("convert_type", { type }, { text: value });
  const item = (id, index) => b("list_item", { item: "any" }, { list: list(id), list_index: n(index) });
  const last = id => b("list_item", { item: "last" }, { list: list(id) });
  const join = value => ({ ...b("text_join", {}, { ADD0: value }), mutation: '<mutation items="1"></mutation>' });
  const append = value => b("list_append", {}, { list: list("runtime"), list_item_value: value });
  const object = () => ({ ...b("_object_literal"), mutation: '<mutation items="0"></mutation>' });
  const missing = () => ({ ...b("_object_get", {}, { obj: get("object"), key: text("absent") }), mutation: '<mutation computed="true"></mutation>' });
  const project = (name, nodes, values) => {
    const p = structuredClone(baseFixtures().conversion);
    p.projectName = `NekoC KN semantics value-types ${name}`;
    const actor = Object.values(p.actors.actorsDict)[0];
    const chain = [b("on_running_group_activated"), ...nodes, set("done", n(1))];
    for (let i = 1; i < chain.length; i++) chain[i - 1].next = chain[i];
    actor.nekoBlockJsonList = [chain[0]];
    const prototype = p.variables.variablesDict.done;
    p.variables.variablesDict = Object.fromEntries(Object.entries({ done: 0, ...values }).map(([id, value]) => [id, {
      ...prototype, id, name: id, value, type: Array.isArray(value) ? "list" : "any",
    }]));
    return p;
  };
  return {
    "initial-lists": project("initial-lists", [
      set("scalarText", get("scalar")), set("first", item("source", 1)),
      set("worldFirst", item("source", 3)),
      b("list_copy", {}, { list: list("source"), target_list: list("copied") }),
    ], { source: ["1", "01", "3333333333333333", "33333333333333333", "1e2", "bad", "", "  ", ["2", "猫", ["3"]]], copied: [], scalar: "1", scalarText: 0, first: 0, worldFirst: 0 }),
    "runtime-lists": project("runtime-lists", [
      append(text("1")), append(text("33333333333333333")), append(n(1)),
      set("first", item("runtime", 1)),
      b("list_copy", {}, { list: list("runtime"), target_list: list("copied") }),
    ], { runtime: [], copied: [], first: 0 }),
    "nested-conversion": project("nested-conversion", [
      set("joined", join(list("source"))), set("convertedText", convert(list("source"), "string")),
      set("convertedNumber", convert(list("source"), "number")),
      set("singletonNumber", convert(list("singleton"), "number")),
    ], { source: [1, "猫", [2, 3]], singleton: [["2"]], joined: "", convertedText: "", convertedNumber: "", singletonNumber: "" }),
    "missing-object": project("missing-object", [
      set("object", object()), set("missing", missing()), set("missingText", join(missing())),
      set("missingNumber", convert(missing(), "number")),
      append(missing()), set("listMissing", item("runtime", 1)),
    ], { object: 0, missing: 0, missingText: "", missingNumber: 0, runtime: [], listMissing: 0 }),
    "nullish-list-item": project("nullish-list-item", [
      set("object", object()), append(missing()),
      set("nullAny", item("nullSource", 1)), set("nullLast", last("nullSource")),
      set("nullAnyText", join(item("nullSource", 1))), set("nullLastText", join(last("nullSource"))),
      set("undefinedAny", item("runtime", 1)), set("undefinedLast", last("runtime")),
      set("undefinedAnyText", join(item("runtime", 1))), set("undefinedLastText", join(last("runtime"))),
      set("directMissingText", join(missing())),
      set("nullListText", join(list("nullSource"))), set("undefinedListText", join(list("runtime"))),
    ], { object: 0, runtime: [], nullSource: [null], nullAny: "unset", nullLast: "unset",
      nullAnyText: "unset", nullLastText: "unset", undefinedAny: "unset", undefinedLast: "unset",
      undefinedAnyText: "unset", undefinedLastText: "unset", directMissingText: "unset",
      nullListText: "unset", undefinedListText: "unset" }),
  };
}

// Same webpack/UI/runtime-manager observation protocol as semantics-kitten-n.mjs.
async function loadOfficial(page, source, result, rawDirectory) {
  for (const [key, pattern] of [["runtimeBundle", /\/crc_libs\.[\w-]+\.js(?:\?.*)?$/], ["mainBundle", /\/main\.[\w-]+\.js(?:\?.*)?$/]]) {
    await page.route(pattern, async route => {
      const response = await route.fetch(), bytes = await response.body();
      result[key] = { url: route.request().url(), sha256: hash(bytes) };
      await writeFile(path.join(rawDirectory, path.basename(new URL(route.request().url()).pathname)), bytes);
      if (key === "mainBundle") {
        const body = bytes.toString("utf8"), marker = "var __webpack_exports__=";
        if (!body.includes(marker)) throw new Error("Official webpack loader changed");
        await route.fulfill({ response, body: body.replace(marker, `window.__nekocRequire=__webpack_require__;${marker}`) });
      } else await route.fulfill({ response, body: bytes });
    });
  }
  const projectUrl = "https://kn.codemao.cn/__nekoc_kn_value_types__.bcmkn";
  await page.route(projectUrl, route => route.fulfill({ contentType: "application/json", body: source }));
  await page.goto(`${officialUrl}?previewUrl=${encodeURIComponent(projectUrl)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") &&
    (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  await page.waitForFunction(name => window.__nekocRequire(91107).BcmInstance.getBcm().projectName === name, JSON.parse(source).projectName);
  await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
  const done = page.getByText(/^完成$/).last();
  if (await done.isVisible()) await done.dispatchEvent("click");
}

export function validateOfficial(report, cases, editor) {
  if (!report.ok || !editor.ok || Object.keys(report.cases).join() !== Object.keys(cases).join()) throw new Error("Incomplete official evidence");
  for (const [name, project] of Object.entries(cases)) {
    const result = report.cases[name];
    if (result.error || result.pageErrors?.length !== 0 || result.variables?.done !== 1 ||
        result.fixture !== `tests/fixtures/kn-value-types/${name}.bcmkn` ||
        result.sha256 !== hash(JSON.stringify(project, null, 2) + "\n") ||
        !result.mainBundle?.sha256 || !result.runtimeBundle?.sha256 ||
        Object.keys(result.variables).sort().join() !== Object.keys(project.variables.variablesDict).sort().join()) throw new Error(`Invalid official observation: ${name}`);
    if (!editor.projects.some(p => p.input.replaceAll("\\", "/").endsWith(result.fixture) && p.sha256 === result.sha256 && p.ok && !p.issues.length && !p.pageErrors.length)) throw new Error(`Missing editor check: ${name}`);
  }
}

async function originalInputs(out) {
  const rawDirectory = path.dirname(path.resolve(out));
  await mkdir(rawDirectory, { recursive: true });
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  const report = { officialUrl, verifiedAt: new Date().toISOString(), browserVersion: browser.version(),
    method: "Exact original project previewUrl import; first runtime list snapshot immediately after Start (not a frame/time parity claim); no synthesized gameplay input.", cases: {} };
  try {
    for (const fixture of ["projects/eisei/eisei_pen_128_fixed.bcmkn", "projects/pencraft/pencraft_flicker_fixed.bcmkn"]) {
      const source = await readFile(path.join(root, fixture), "utf8"), project = JSON.parse(source);
      const result = report.cases[fixture.includes("eisei") ? "eisei" : "pencraft"] = { fixture, sha256: hash(source), pageErrors: [] };
      const page = await browser.newPage();
      page.on("pageerror", error => result.pageErrors.push(String(error)));
      try {
        await loadOfficial(page, source, result, rawDirectory);
        await page.getByText(/^开始$/).last().dispatchEvent("click");
        result.lists = await page.evaluate(() => {
          const req = window.__nekocRequire, manager = req(26921).cG.get_instance().getHeart().core.get_runtime_manager();
          return Object.fromEntries(Object.entries(req(91107).BcmInstance.variablesDict).filter(([, v]) => v.type === "list").map(([id, v]) => {
            const value = manager.get_variable(id, undefined, v.currentEntityId);
            if (!Array.isArray(value)) throw new Error(`Expected runtime list: ${id}`);
            return [id, { length: value.length, head: value.slice(0, 3), headTypes: value.slice(0, 3).map(v => typeof v) }];
          }));
        });
        result.matchesSource = Object.entries(result.lists).every(([id, actual]) => {
          const initial = project.variables.variablesDict[id].value;
          return actual.length === initial.length && JSON.stringify(actual.head) === JSON.stringify(initial.slice(0, 3));
        });
      } catch (error) { result.error = String(error); }
      finally { await page.close(); }
      console.log(JSON.stringify(result));
    }
  } finally { await browser.close(); }
  report.ok = Object.values(report.cases).every(r => !r.error && !r.pageErrors.length && r.matchesSource);
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  if (!report.ok) process.exitCode = 1;
}

async function main() {
  const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
  const cases = fixtures();
  if (process.argv.includes("--original-inputs")) {
    if (!option("--out")) throw new Error("--original-inputs requires --out");
    return originalInputs(option("--out"));
  }
  if (process.argv.includes("--generate")) {
    await mkdir(directory, { recursive: true });
    for (const [name, p] of Object.entries(cases)) await writeFile(path.join(directory, `${name}.bcmkn`), JSON.stringify(p, null, 2) + "\n");
    return;
  }
  if (option("--archive")) {
    const report = JSON.parse(await readFile(option("--archive"), "utf8"));
    const editor = JSON.parse(await readFile(option("--editor"), "utf8"));
    validateOfficial(report, cases, editor);
    for (const result of Object.values(report.cases)) {
      const bytes = await readFile(path.join(root, result.fixture));
      if (hash(bytes) !== result.sha256) throw new Error(`Stale fixture: ${result.fixture}`);
      delete result.nekoc;
      delete result.equal;
      delete result.scripts;
    }
    for (const p of editor.projects) p.input = path.relative(root, p.input).replaceAll("\\", "/");
    let originalInputs;
    if (option("--original-report")) {
      const original = JSON.parse(await readFile(option("--original-report"), "utf8"));
      if (!original.ok || Object.keys(original.cases).length !== 2) throw new Error("Incomplete original project evidence");
      for (const result of Object.values(original.cases)) {
        if (result.error || result.pageErrors.length || !result.matchesSource || !result.mainBundle?.sha256 || !result.runtimeBundle?.sha256 ||
            hash(await readFile(path.join(root, result.fixture))) !== result.sha256) throw new Error("Invalid original project evidence");
        // Keep just the two disputed lists in the compact checked-in evidence.
        result.lists = Object.fromEntries(Object.entries(result.lists).filter(([id]) => ["kn-list-ep_bank_color", "kn-list-world"].includes(id)));
      }
      originalInputs = original;
    }
    await writeFile(path.join(root, "docs/kn-value-types-official.json"), JSON.stringify({ ...report, editorCompat: editor, originalInputs }, null, 2) + "\n");
    return;
  }
  const out = option("--out");
  if (!out) throw new Error("Usage: --generate | --out report.json [--nekoc exe] | --archive report.json --editor editor.json");
  const rawDirectory = path.dirname(path.resolve(out));
  await mkdir(rawDirectory, { recursive: true });
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  const report = { officialUrl, verifiedAt: new Date().toISOString(), browserVersion: browser.version(), cases: {} };
  const savedBundles = new Set();
  try {
    for (const name of Object.keys(cases)) {
      const page = await browser.newPage(), result = report.cases[name] = { pageErrors: [] };
      page.on("pageerror", error => result.pageErrors.push(String(error)));
      try {
        result.fixture = `tests/fixtures/kn-value-types/${name}.bcmkn`;
        const filename = path.join(root, result.fixture), source = await readFile(filename, "utf8");
        result.sha256 = hash(source);
        await probe(page, source, result);
        // Fetch unchanged bytes, not the page's loader-instrumented response.
        for (const bundle of [result.mainBundle, result.runtimeBundle]) {
          if (savedBundles.has(bundle.sha256)) continue;
          const response = await page.request.get(bundle.url);
          if (!response.ok()) throw new Error(`Cannot archive official bundle: ${response.status()}`);
          const bytes = await response.body();
          if (hash(bytes) !== bundle.sha256) throw new Error("Official bundle changed during observation");
          await writeFile(path.join(rawDirectory, path.basename(new URL(bundle.url).pathname)), bytes);
          savedBundles.add(bundle.sha256);
        }
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
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
