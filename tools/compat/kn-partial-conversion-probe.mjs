#!/usr/bin/env node
// Original conversion projects; reuse the authoritative native-project probe.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures, probe, matchingVariables, matchingEditorCheck, validateObservation, officialUrl } from "../semantics-kitten-n.mjs";
import { loadPlaywright } from "../probe-kitten4.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(root, "tests/fixtures/kn-partial-conversion");
const hash = value => createHash("sha256").update(value).digest("hex");
let serial = 0;
const b = (type, fields = {}, inputs = {}) => ({ id: `knpc-${++serial}`, type, fields, inputs });
const n = value => b("math_number", { NUM: String(value) });
const text = value => b("text", { TEXT: value });
const get = variable => b("variables_get", { variable });
const set = (variable, value) => b("variables_set", { variable }, { value });
const array = (...items) => ({ ...b("_array_literal", {}, Object.fromEntries(items.map((v, i) => [`items${i}`, v]))), mutation: `<mutation items="${items.length}"></mutation>` });
const object = (...pairs) => ({ ...b("_object_literal", {}, Object.fromEntries(pairs.flatMap(([k, v], i) => [[`key${i}`, text(k)], [`value${i}`, v]]))), mutation: `<mutation items="${pairs.length}"></mutation>` });
const assign = (obj, key, value) => ({ ...b("_object_set", {}, { obj, key, value }), mutation: '<mutation computed="true"></mutation>' });
const convert = (value, type) => b("convert_type", { type }, { text: value });
const chain = (...nodes) => { for (let i = 1; i < nodes.length; i++) nodes[i - 1].next = nodes[i]; return nodes[0]; };

export function conversionProjects() {
  serial = 0;
  const cases = {};
  function project(name, body, outputs) {
    const p = structuredClone(fixtures().conversion);
    p.projectName = `NekoC KN semantics partial-conversion ${name}`;
    const actor = Object.values(p.actors.actorsDict)[0];
    actor.nekoBlockJsonList = [chain(b("on_running_group_activated"), ...body, set("a", n(0)), set("b", n(0)), set("done", n(1)))];
    const base = structuredClone(p.variables.variablesDict.done);
    p.variables.variablesDict = Object.fromEntries(["a", "b", "done", ...outputs].map(id => [id, { ...base, id, name: id, type: "any", value: 0 }]));
    cases[name] = p;
  }
  function observe(prefix, input, body, outputs) {
    // Some official sockets reject direct array/JSON reporters. Store first;
    // variables_get is the editor-supported any-value connection.
    body.push(set("b", input()));
    for (const type of ["number", "string", "boolean"]) {
      const id = `${prefix}_${type}`;
      outputs.push(id);
      body.push(set(id, convert(get("b"), type)));
    }
  }
  {
    const body = [], outputs = [];
    body.push(set("a", array()), assign(get("a"), n(0), get("a")));
    observe("self", () => get("a"), body, outputs);
    body.push(set("a", array(n(1))), assign(get("a"), n(1), get("a")));
    observe("self_tail", () => get("a"), body, outputs);
    body.push(set("a", array(n(1))), set("b", array(n(2))), assign(get("a"), n(1), get("b")), assign(get("b"), n(1), get("a")));
    observe("mutual", () => get("a"), body, outputs);
    body.push(set("a", array(n(7))), set("b", array(get("a"), get("a"))));
    observe("shared", () => get("b"), body, outputs);
    body.push(set("a", object(["x", n(1)])), assign(get("a"), text("self"), get("a")));
    observe("object_cycle", () => get("a"), body, outputs);
    observe("array_object", () => array(get("a")), body, outputs);
    body.push(set("a", object(["valueOf", text("17")], ["constructor", n(2)])));
    observe("object_shadow_valueof", () => get("a"), body, outputs);
    project("graphs", body, outputs);
  }
  {
    const body = [], outputs = [];
    for (const depth of [127, 128, 129, 256]) {
      body.push(set("a", n(7)));
      // kn-trace observes 180 frames. Build the graph in warp rather than
      // spending 640 yield frames before reaching the final done sentinel.
      body.push({ ...b("warp"), statements: { DO: { ...b("repeat_n_times", {}, { times: n(depth) }), statements: { DO: set("a", array(get("a"))) } } } });
      observe(`depth${depth}`, () => get("a"), body, outputs);
    }
    project("deep", body, outputs);
  }
  {
    const body = [], outputs = [];
    const parse = s => b("JSON.parse", {}, { text: text(s) });
    for (const [label, input] of [
      ["null_undefined", () => array(parse("null"), { ...b("_object_get", {}, { obj: object(), key: text("absent") }), mutation: '<mutation computed="true"></mutation>' })],
      ["nested_null", () => array(array(parse("null")))],
      ["nan_array", () => array(text("NaN"))],
      ["numeric_nan_array", () => array(b("math_arithmetic", { type: "divide" }, { A: n(0), B: n(0) }))],
      ["empty_object", () => object()],
      ["object_json", () => parse('{"toJSON":3,"valueOf":null}')],
    ]) observe(label, input, body, outputs);
    project("values", body, outputs);
  }
  return cases;
}

async function localCalls(page) {
  return page.evaluate(() => {
    const req = window.__nekocRequire;
    const registry = req(26921).cG.get_instance().getHeart().core.get_registry();
    const fn = registry.domain_function_list[registry.get_domain_function_index("convert_type")];
    const self = []; self.push(self);
    const tail = [1]; tail.push(tail);
    const a = [1], b = [2]; a.push(b); b.push(a);
    const child = [7], obj = { a: 1 }; obj.self = obj;
    const deep = depth => { let a = 7; while (depth--) a = [a]; return a; };
    const cases = [["self", self], ["self_tail", tail], ["mutual", a], ["shared", [child, child]], ["object_cycle", obj], ["array_object", [obj]],
      ["object_shadow_valueof", { valueOf: "17", constructor: 2 }],
      ["object_shadow_tostring", { toString: "17" }], ["object_shadow_both", { toString: null, valueOf: 17 }],
      ["array_shadow_tostring", [{ toString: "17" }]],
      ["object_own_valueof_callable", { valueOf() { return 17; } }],
      ["depth127", deep(127)], ["depth128", deep(128)], ["depth129", deep(129)], ["depth256", deep(256)]];
    const encode = v => ({ type: typeof v, value: typeof v === "number" && !Number.isFinite(v) ? String(v) : v });
    const calls = [];
    for (const [label, value] of cases) for (const type of ["number", "string", "boolean"]) {
      try { calls.push({ label, target: type, result: encode(fn({ type, text: value }, "probe", "probe-actor", "probe-actor", "probe", {})) }); }
      catch (error) { calls.push({ label, target: type, error: String(error) }); }
    }
    return { editorVersion: req(91107).BcmInstance.getBcm().version, calls };
  });
}

export async function validateArchive(report) {
  if (!report.ok || !report.editorCompat?.ok || report.local?.editorVersion !== "0.27.4") throw new Error("Refuse unverified archive");
  const projects = conversionProjects();
  if (JSON.stringify(Object.keys(report.cases).sort()) !== JSON.stringify(Object.keys(projects).sort()) || report.editorCompat.projects.length !== 3) throw new Error("Incomplete project observations");
  const labels = ["self", "self_tail", "mutual", "shared", "object_cycle", "array_object", "object_shadow_valueof", "object_shadow_tostring", "object_shadow_both", "array_shadow_tostring", "object_own_valueof_callable", "depth127", "depth128", "depth129", "depth256"];
  if (report.local.calls.length !== 45 || new Set(report.local.calls.map(c => `${c.label}/${c.target}`)).size !== 45 || report.local.calls.some(c => !labels.includes(c.label) || !["number", "string", "boolean"].includes(c.target) || (!c.result && !c.error))) throw new Error("Incomplete local observations");
  for (const project of report.editorCompat.projects) project.input = path.relative(root, path.resolve(root, project.input)).replaceAll("\\", "/");
  let conversions = 0;
  for (const [name, result] of Object.entries(report.cases)) {
    const bytes = await readFile(path.join(root, result.fixture));
    if (result.fixture !== `tests/fixtures/kn-partial-conversion/${name}.bcmkn` || result.sha256 !== hash(bytes) || bytes.toString() !== JSON.stringify(projects[name], null, 2) + "\n") throw new Error("Stale fixture");
    const ids = Object.keys(projects[name].variables.variablesDict).sort();
    if (JSON.stringify(Object.keys(result.variables).sort()) !== JSON.stringify(ids) || result.variables.done !== 1 || result.error || result.pageErrors.length) throw new Error("Incomplete native observation");
    if (!result.mainBundle?.sha256 || !result.runtimeBundle?.sha256) throw new Error("Missing official bundle identity");
    if (!report.editorCompat.projects.some(project => matchingEditorCheck(project, result))) throw new Error("Missing matching editor check");
    if (result.equal !== undefined || result.nekoc !== undefined) validateObservation(result, projects[name]);
    conversions += ids.length - 3;
  }
  if (conversions !== 51) throw new Error("Incomplete conversion observations");
  report.nativeDifferentialVerified = Object.values(report.cases).every(result => result.equal === true && matchingVariables(result.variables, result.nekoc?.variables));
  if (report.nativeDifferentialVerified && (!report.pairing?.binarySha256 || !report.pairing?.comparedAt)) throw new Error("Missing pairing provenance");
  return report;
}

async function archive(report, editorCheck) {
  if (editorCheck) report.editorCompat = JSON.parse(await readFile(editorCheck, "utf8"));
  await validateArchive(report);
  await writeFile(path.join(root, "docs/kn-partial-conversion.json"), JSON.stringify(report, null, 2) + "\n");
}

async function pairingMetadata(binary, input) {
  return { comparedAt: new Date().toISOString(), binary: path.relative(root, path.resolve(binary)).replaceAll("\\", "/"), binarySha256: hash(await readFile(binary)), input, method: "kn-trace native project playback; exact typed variable comparison including done=1" };
}

async function main() {
  const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
  if (option("--compare")) {
    if (!option("--nekoc") || !option("--out")) throw new Error("--compare requires --nekoc and --out");
    const report = JSON.parse(await readFile(option("--compare"), "utf8"));
    report.pairing = await pairingMetadata(option("--nekoc"), option("--compare"));
    for (const [name, result] of Object.entries(report.cases)) {
      const filename = path.join(root, result.fixture);
      if (result.sha256 !== hash(await readFile(filename))) throw new Error("Stale fixture");
      const run = spawnSync(path.resolve(option("--nekoc")), [filename], { encoding: "utf8", timeout: 30000 });
      if (run.status !== 0) throw new Error(run.stderr || String(run.error));
      result.nekoc = JSON.parse(run.stdout);
      result.equal = matchingVariables(result.variables, result.nekoc.variables);
      console.log(JSON.stringify({ name, equal: result.equal }));
    }
    report.nativeDifferentialVerified = Object.values(report.cases).every(result => result.equal === true);
    report.ok = report.nativeDifferentialVerified && Object.values(report.cases).every(result => !result.error && !result.pageErrors.length);
    await mkdir(path.dirname(path.resolve(option("--out"))), { recursive: true });
    await writeFile(option("--out"), JSON.stringify(report, null, 2) + "\n");
    if (process.argv.includes("--archive")) await archive(report, option("--editor-check"));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (option("--archive")) {
    const report = JSON.parse(await readFile(option("--archive"), "utf8"));
    await archive(report, option("--editor-check"));
    return;
  }
  const projects = conversionProjects();
  await mkdir(directory, { recursive: true });
  for (const [name, p] of Object.entries(projects)) await writeFile(path.join(directory, `${name}.bcmkn`), JSON.stringify(p, null, 2) + "\n");
  if (process.argv.includes("--generate")) return;
  const out = path.resolve(option("--out") ?? "dist/kn-partial-conversion/report.json");
  const browser = await loadPlaywright().chromium.launch({ headless: true, channel: "msedge" });
  const report = { schema: "nekoc-kn-partial-conversion-v1", officialUrl, verifiedAt: new Date().toISOString(), browserVersion: browser.version(), cases: {} };
  if (option("--nekoc")) report.pairing = await pairingMetadata(option("--nekoc"), "fresh official observations");
  try {
    for (const name of Object.keys(projects)) {
      const page = await browser.newPage(), result = report.cases[name] = { pageErrors: [] };
      page.on("pageerror", error => result.pageErrors.push(String(error)));
      try {
        const filename = path.join(directory, `${name}.bcmkn`), source = await readFile(filename, "utf8");
        result.fixture = path.relative(root, filename).replaceAll("\\", "/");
        result.sha256 = hash(source);
        await probe(page, source, result);
        if (name === "graphs") report.local = await localCalls(page);
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
  if (option("--editor-check")) report.editorCompat = JSON.parse(await readFile(option("--editor-check"), "utf8"));
  report.ok = Object.values(report.cases).every(r => r.variables && !r.error && !r.pageErrors.length && r.equal !== false);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
