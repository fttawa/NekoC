#!/usr/bin/env node
// Official lazy microbit extension oracle; downloaded code stays in dist.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const out = "dist/kn-microbit-map";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES || "dist/kn-offline-round3/deps/node_modules", "package.json"));
const { chromium } = require("playwright");
await fs.mkdir(out, { recursive: true });
const report = { schema: "nekoc-kn-microbit-map-official-v1", checkedAt: new Date().toISOString(), editorUrl: "https://kn.codemao.cn/editor", method: "Fresh headless official Edge editor with webpack loader exposed; load official lazy microbit module and call its actual exported domain function factory. No hardware map or connection helper replaced; no hardware connection attempted.", bundles: [], pageErrors: [], limitations: ["Direct official domain function calls, not a complete native project or registered hardware workspace.", "No connected-device behavior measured; mapping algorithm after the connection guard is source-only evidence.", "All five block value sockets must still be evaluated by the caller; direct early return from the domain function does not authorize compiler input elision."] };
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", e => report.pageErrors.push(e.message));
  await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body();
    const url = route.request().url(), name = path.basename(new URL(url).pathname);
    await fs.writeFile(`${out}/${name}`, bytes);
    report.bundles.push({ name, url, bytes: bytes.length, sha256: sha256(bytes) });
    const body = name.startsWith("main.") ? bytes.toString("utf8").replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") : bytes;
    await route.fulfill({ response, body });
  });
  await page.goto(report.editorUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas"), null, { timeout: 120000 });
  report.editor = await page.evaluate(async () => {
    const req = window.__nekocRequire;
    await Promise.all([1359, 5337, 8205, 2308].map(id => req.e(id)));
    const extension = req(83939);
    const modules = Object.entries(req.m).filter(([, f]) => /map_microbit_range|microbitMathMap|fromStart.*fromEnd.*toStart/.test(String(f))).map(([id, f]) => ({ id, source: String(f) }));
    const hardware = req(87282), functions = req(20592).d(), fn = functions.microbit_math_map;
    const encode = value => ({ type: typeof value, ...(value === undefined ? {} : { value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value }) });
    const base = { value: "512", fromStart: "0", fromEnd: "1023", toStart: "1", toEnd: "10" };
    const cases = [
      ["ordinary numeric strings", base],
      ["ordinary numbers", { value: 5, fromStart: 0, fromEnd: 10, toStart: 0, toEnd: 100 }],
      ["invalid value", { ...base, value: "bad" }],
      ["empty value", { ...base, value: "" }],
      ["degenerate source range", { ...base, fromEnd: "0" }],
      ["outside range", { ...base, value: "9999" }],
      ["infinite input", { ...base, value: Infinity }],
    ];
    const calls = [];
    for (const [label, args] of cases) {
      try { const value = fn(args, "probe", "probe-actor", {}, "probe", {}); calls.push({ label, args: Object.fromEntries(Object.entries(args).map(([k,v]) => [k, encode(v)])), promise: !!value?.then, result: encode(value?.then ? await value : value) }); }
      catch (e) { calls.push({ label, error: String(e) }); }
    }
    let getterReads = 0;
    const guardedArgs = Object.fromEntries(Object.keys(base).map(k => [k, undefined]));
    for (const key of Object.keys(base)) Object.defineProperty(guardedArgs, key, { get() { getterReads++; throw new Error("Unexpected argument property read"); } });
    let guardedResult;
    try { guardedResult = { result: encode(fn(guardedArgs, "probe", "probe-actor", {}, "probe", {})), getterReads }; }
    catch (e) { guardedResult = { error: String(e), getterReads }; }
    const config = req(66111).MICROBIT_BLOCKS.find(b => b.type === "microbit_math_map");
    return { version: req(91107).BcmInstance.getBcm().version, extensionKeys: Object.keys(extension), domainFactoryModule: 20592, domainName: "microbit_math_map", hardwareIds: [...hardware.hardwareMap.keys()], hasMicrobit: hardware.isHardwareExists("microbit"), inputSockets: config?.args0?.filter(a => a.type === "input_value").map(a => ({ name: a.name, defaultValue: a.defaultValue })), calls, guardedResult, functionSource: String(fn), modules };
  });
} catch (e) { report.failure = e.stack; process.exitCode = 1; }
finally { await browser.close(); }
await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
const anchors = [
  ["microbit_lazy_module", "main.8ccf2442.js", '"./microbit":[83939,9,1359,5337,8205,2308]', 400],
  ["domain_factory", "entry_hardware.481194e4.chunk.js", "20592:function(e,t,r)", 400],
  ["microbit_math_map", "entry_hardware.481194e4.chunk.js", "(0,n.Z)(e,l.k.microbitMathMap,", 1740],
  ["hardware_connection_guard", "main.8ccf2442.js", "function _(e){var t=o.cG.get_instance().runtimeId;", 1200],
];
report.sourceLocations = [];
for (const [symbol, name, anchor, excerptCharacters] of anchors) {
  const bundle = report.bundles.find(b => b.name === name);
  if (!bundle) continue;
  const bytes = await fs.readFile(`${out}/${name}`), source = bytes.toString("utf8"), index = source.indexOf(anchor);
  report.sourceLocations.push({ symbol, bundle: name, bundleUrl: bundle.url, bundleSha256: bundle.sha256, byteOffset: index < 0 ? null : Buffer.byteLength(source.slice(0, index)), excerptCharacters, excerptSha256: index < 0 ? null : sha256(source.slice(index, index + excerptCharacters)) });
}
report.checks = {
  sourceAnchorsFound: report.sourceLocations.length === anchors.length && report.sourceLocations.every(l => l.byteOffset !== null),
  noHardware: report.editor?.hasMicrobit === false && report.editor.hardwareIds.length === 0,
  actualFunctionReturnsNaNWithoutHardware: report.editor?.calls.length === 7 && report.editor.calls.every(c => c.result?.type === "number" && c.result.value === "NaN" && c.promise === false),
  guardBeforeArgumentAccess: report.editor?.guardedResult?.getterReads === 0 && report.editor.guardedResult.result?.type === "number" && report.editor.guardedResult.result.value === "NaN",
  noUncaughtPageErrors: report.pageErrors.length === 0,
};
report.ok = !report.failure && Object.values(report.checks).every(Boolean);
await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
if (!report.ok) process.exitCode = 1;
if (process.argv.includes("--record") && report.ok) {
  const { modules, functionSource, ...editor } = report.editor;
  await fs.writeFile("docs/kn-microbit-map-evidence.json", JSON.stringify({ ...report, editor }, null, 2) + "\n");
}
console.log(JSON.stringify({ ok: report.ok, failure: report.failure, checks: report.checks, editor: report.editor && { version: report.editor.version, inputSockets: report.editor.inputSockets, calls: report.editor.calls, guardedResult: report.editor.guardedResult }, sourceLocations: report.sourceLocations }, null, 2));
