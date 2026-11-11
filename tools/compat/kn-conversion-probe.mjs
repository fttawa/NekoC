#!/usr/bin/env node
// Authored calls only; official function bodies remain under ignored dist/.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const out = "dist/kn-conversion";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES, "package.json"));
const { chromium } = require("playwright");
await fs.mkdir(out, { recursive: true });
const report = { schema: "nekoc-kn-conversion-v1", editorUrl: "https://kn.codemao.cn/editor", checkedAt: new Date().toISOString(), bundles: [], pageErrors: [], method: "Fresh anonymous official Edge editor; expose webpack loader and call unchanged registered convert_type domain function. No service or conversion helper replaced.", limitations: ["Direct domain calls, not complete project playback.", "Warning UI, custom object prototypes and cyclic values are not validated."] };
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
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  report.editor = await page.evaluate(() => {
    const req = window.__nekocRequire;
    const registry = req(26921).cG.get_instance().getHeart().core.get_registry();
    const index = registry.get_domain_function_index("convert_type"), fn = registry.domain_function_list[index];
    const encode = value => ({ type: typeof value, ...(value === undefined ? {} : Array.isArray(value) ? { items: value.map(encode) } : { value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value }) });
    const cases = [["null", null], ["undefined", undefined], ["true", true], ["false", false], ["empty array", []], ["singleton number", [12]], ["singleton numeric text", ["0x10"]], ["singleton bad text", ["bad"]], ["two items", [1, 2]], ["nested singleton", [[7]]], ["null item", [null]], ["undefined item", [undefined]], ["object", { a: 1 }], ["NaN", NaN], ["Infinity", Infinity], ["empty", ""], ["space", " "], ["binary", "0b11"], ["octal", "0o17"], ["invalid", "bad"], ["literal NaN", "NaN"]];
    const calls = [];
    for (const [label, text] of cases) for (const type of ["number", "string", "boolean"]) {
      try { calls.push({ label, target: type, input: encode(text), result: encode(fn({ type, text }, "probe", "probe-actor", "probe-actor", "probe", {})) }); }
      catch (e) { calls.push({ label, target: type, error: String(e) }); }
    }
    return { version: req(91107).BcmInstance.getBcm().version, domainIndex: index, calls, functionSource: String(fn) };
  });
} catch (e) { report.failure = e.stack; }
finally { await browser.close(); }
report.sourceLocations = [];
for (const bundle of report.bundles) {
  const bytes = await fs.readFile(`${out}/${bundle.name}`), source = bytes.toString("utf8");
  const anchor = "convertType,(function", index = source.indexOf(anchor);
  if (index >= 0) report.sourceLocations.push({ symbol: "convert_type", bundle: bundle.name, bundleUrl: bundle.url, bundleSha256: bundle.sha256, byteOffset: Buffer.byteLength(source.slice(0, index)), excerptCharacters: 1800, excerptSha256: sha256(source.slice(index, index + 1800)) });
}
report.ok = !report.failure && report.editor?.calls.length === 63 && report.editor.calls.every(c => c.result) && report.sourceLocations.length > 0 && report.pageErrors.length === 0;
await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
if (process.argv.includes("--record") && report.ok) {
  const { functionSource, ...editor } = report.editor;
  await fs.writeFile("docs/kn-conversion-evidence.json", JSON.stringify({ ...report, editor }, null, 2) + "\n");
}
if (!report.ok) process.exitCode = 1;
console.log(JSON.stringify(report, (key, value) => key === "functionSource" ? undefined : value, 2));
