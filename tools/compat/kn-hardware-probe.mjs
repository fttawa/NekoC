#!/usr/bin/env node
// Authored oracle. Official bundles and function bodies are saved only in dist.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const out = "dist/kn-hardware";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES || `${out}/deps/node_modules`, "package.json"));
const { chromium } = require("playwright");
const selected = ["microbit_led_is_plot", "microbit_button_is_pressed", "microbit_pin_digital_read", "microbit_pin_analog_read", "microbit_logo_is_pressed", "microbit_is_gesture", "microbit_math_map"];
const report = {
  schema: "nekoc-kn-disconnected-microbit-v1", checkedAt: new Date().toISOString(),
  editorUrl: "https://kn.codemao.cn/editor",
  method: "Fresh official Edge editor; expose webpack loader, load actual microbit lazy extension, read its official MICROBIT_BLOCKS panel definitions and call actual domain functions. Hardware map and connection guard are untouched; no device connection attempted.",
  limitations: ["Direct official domain calls and panel definitions, not a full native project execution.", "Only an empty hardware map is measured. Connected behavior is explicitly unsupported.", "Domain argument access is not child block evaluation: caller must evaluate all panel value sockets even when the disconnected guard ignores their values.", "Async sensor reporters, commands, events, catbit and robot are not implemented by this profile."],
  bundles: [], pageErrors: [],
};
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", error => report.pageErrors.push(error.message));
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
  report.editor = await page.evaluate(async selected => {
    const req = window.__nekocRequire;
    await Promise.all([1359, 5337, 8205, 2308].map(id => req.e(id)));
    const extension = req(83939), hardware = req(87282), functions = req(20592).d();
    const panelModule = req(66111);
    const configs = [...panelModule.MICROBIT_BLOCKS, ...Object.values(panelModule.MICROBIT_SHORT_BLOCKS).flat()];
    const encode = value => ({ type: typeof value, ...(value === undefined ? {} : { value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value }) });
    const cases = [], panels = [], functionSources = {};
    for (const name of selected) {
      const config = configs.find(block => block.type === name);
      if (!config || typeof functions[name] !== "function") throw new Error("Missing actual panel/function: " + name + " panel=" + !!config + " domain=" + typeof functions[name] + " panels=" + configs.map(block => block.type).filter(Boolean).join(","));
      const args0 = config.args0 || [];
      panels.push({ name, output: config.output, sockets: args0.filter(arg => arg.type === "input_value").map(arg => ({ name: arg.name, defaultValue: arg.defaultValue })), fields: args0.filter(arg => arg.name && arg.type !== "input_value").map(arg => ({ name: arg.name, type: arg.type, options: arg.options, value: arg.value })) });
      functionSources[name] = String(functions[name]);
      const defaults = Object.fromEntries(args0.filter(arg => arg.name).map(arg => [arg.name, arg.defaultValue ?? arg.options?.menu_generator_advanced?.[0]?.[1] ?? arg.value ?? "probe"]));
      const variants = [["panel defaults", defaults], ["invalid", Object.fromEntries(Object.keys(defaults).map(key => [key, "not-a-number"]))], ["empty", Object.fromEntries(Object.keys(defaults).map(key => [key, ""]))]];
      for (const field of args0.filter(arg => arg.name && arg.type !== "input_value")) {
        const options = field.options?.menu_generator_advanced;
        if (Array.isArray(options)) for (const option of options) variants.push(["menu " + field.name + "=" + option[1], { ...defaults, [field.name]: option[1] }]);
      }
      for (const [label, args] of variants) {
        try {
          const value = functions[name](args, "probe", "probe-actor", {}, "probe", {});
          cases.push({ name, label, args, promise: !!value?.then, result: encode(value?.then ? await value : value) });
        } catch (error) { cases.push({ name, label, error: String(error) }); }
      }
      const argumentReads = [];
      const observedArgs = new Proxy(defaults, { get(target, key) { argumentReads.push(String(key)); return target[key]; } });
      try {
        const value = functions[name](observedArgs, "probe", "probe-actor", {}, "probe", {});
        cases.push({ name, label: "argument access", argumentReads, promise: !!value?.then, result: encode(value?.then ? await value : value) });
      } catch (error) { cases.push({ name, label: "argument access", argumentReads, error: String(error) }); }
    }
    return { version: req(91107).BcmInstance.getBcm().version, extensionKeys: Object.keys(extension), lazyModule: 83939, panelModule: 66111, domainModule: 20592, hardwareIds: [...hardware.hardwareMap.keys()], hasMicrobit: hardware.isHardwareExists("microbit"), panels, cases, functionSources, allDomainNames: Object.keys(functions) };
  }, selected);
} catch (error) { report.failure = error.stack; }
finally { await browser.close(); }
report.sourceLocations = [];
for (const [name, source] of Object.entries(report.editor?.functionSources || {})) {
  for (const bundle of report.bundles) {
    const text = await fs.readFile(`${out}/${bundle.name}`, "utf8"), index = text.indexOf(source);
    if (index < 0) continue;
    report.sourceLocations.push({ symbol: name, bundle: bundle.name, bundleUrl: bundle.url, bundleSha256: bundle.sha256, byteOffset: Buffer.byteLength(text.slice(0, index)), excerptCharacters: source.length, excerptSha256: sha256(source) });
    break;
  }
}
const predicates = new Set(["microbit_led_is_plot", "microbit_button_is_pressed", "microbit_logo_is_pressed", "microbit_is_gesture"]);
report.checks = {
  noHardware: report.editor?.hasMicrobit === false && report.editor.hardwareIds.length === 0,
  completePanels: report.editor?.panels.length === selected.length,
  actualTypedResults: report.editor?.cases.length >= selected.length * 4 && report.editor.cases.every(test => !test.error && test.promise === false && (predicates.has(test.name) ? test.result?.type === "boolean" && test.result.value === false : test.result?.type === "number" && test.result.value === "NaN")),
  sourceAnchorsFound: report.sourceLocations.length === selected.length,
  noUncaughtPageErrors: report.pageErrors.length === 0,
};
report.ok = !report.failure && Object.values(report.checks).every(Boolean);
await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
if (process.argv.includes("--record") && report.ok) {
  const summary = {
    schema: "nekoc-kn-disconnected-microbit-summary-v1", checkedAt: report.checkedAt,
    editorUrl: report.editorUrl, version: report.editor.version,
    probe: "tools/compat/kn-hardware-probe.mjs", fullLocalReport: `${out}/report.json`,
    method: report.method,
    modules: { lazyExtension: 83939, panel: 66111, domainFactory: 20592, hardware: 87282 },
    hardwareIds: report.editor.hardwareIds, hasMicrobit: report.editor.hasMicrobit,
    caseCount: report.editor.cases.length, pageErrors: report.pageErrors, checks: report.checks,
    bundles: report.bundles.filter(b => ["main.8ccf2442.js", "2308.b9eeff62.chunk.js", "entry_hardware.481194e4.chunk.js"].includes(b.name)),
    reporters: report.editor.panels.map(panel => {
      const calls = report.editor.cases.filter(c => c.name === panel.name);
      const source = report.sourceLocations.find(l => l.symbol === panel.name);
      return { name: panel.name, panelOutput: panel.output,
        inputs: panel.sockets.map(s => s.name), fields: panel.fields,
        promise: calls[0].promise, result: calls[0].result,
        argumentReads: calls.find(c => c.label === "argument access").argumentReads,
        cases: calls.map(({ name, ...rest }) => rest), source };
    }),
    limitations: report.limitations,
  };
  await fs.writeFile("docs/kn-hardware-evidence.json", JSON.stringify(summary, null, 2) + "\n");
}
if (!report.ok) process.exitCode = 1;
console.log(JSON.stringify({ ok: report.ok, failure: report.failure, checks: report.checks, panels: report.editor?.panels, argumentReads: report.editor?.cases.filter(test => test.label === "argument access").map(test => ({ name: test.name, reads: test.argumentReads })), sourceLocations: report.sourceLocations }, null, 2));
