#!/usr/bin/env node
// Original probe; downloaded official code and full function text stay in ignored dist.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { catalogTypes } from "./kn-catalog-manifest.mjs";

const out = "dist/kn-hardware-remaining";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES || `${out}/deps/node_modules`, "package.json"));
const { chromium } = require("playwright");
const report = {
  schema: "nekoc-kn-disconnected-microbit-remaining-v1", checkedAt: new Date().toISOString(),
  editorUrl: "https://kn.codemao.cn/editor", bundles: [], pageErrors: [],
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
  report.editor = await page.evaluate(async () => {
    const req = window.__nekocRequire;
    await Promise.all([1359, 5337, 8205, 2308].map(id => req.e(id)));
    req(83939);
    const hardware = req(87282), functions = req(20592).d();
    const panelModule = req(66111);
    const configs = [...panelModule.MICROBIT_BLOCKS, ...Object.values(panelModule.MICROBIT_SHORT_BLOCKS).flat()];
    const covered = new Set(["microbit_led_is_plot", "microbit_button_is_pressed", "microbit_pin_digital_read", "microbit_pin_analog_read", "microbit_logo_is_pressed", "microbit_is_gesture", "microbit_math_map"]);
    const panels = configs.filter(c => c.type?.startsWith("microbit_")).map(c => ({
      name: c.type, kind: c.output ? "reporter" : c.previousStatement ? "command" : "event", output: c.output,
      inputs: (c.args0 || []).filter(a => a.type === "input_value").map(a => a.name),
      fields: (c.args0 || []).filter(a => a.name && a.type !== "input_value").map(a => ({ name: a.name, type: a.type, value: a.value, options: a.options })),
      defaults: Object.fromEntries((c.args0 || []).filter(a => a.name).map(a => [a.name, a.defaultValue ?? a.options?.menu_generator_advanced?.[0]?.[1] ?? a.value ?? "probe"])),
    }));
    const encode = value => ({ type: typeof value, ...(value === undefined ? {} : { value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value }) });
    const cases = [];
    const runtime = req(26921).cG.get_instance().getHeart().core.get_runtime_manager();
    const actionCalls = [], originalSendAction = runtime.send_action;
    runtime.send_action = function(action, ...rest) { actionCalls.push(action); return originalSendAction.call(this, action, ...rest); };
    const errors = req(31152).x.get_instance(), errorCalls = [], originalAddError = errors.addError;
    errors.addError = function(error, ...rest) { errorCalls.push({ type: typeof error }); return originalAddError.call(this, error, ...rest); };
    try {
    for (const name of Object.keys(functions).filter(name => !covered.has(name))) {
      const panel = panels.find(p => p.name === name), defaults = panel?.defaults || { key: "0", value: "1", angle: "90" };
      const variants = [["defaults", defaults], ["invalid", Object.fromEntries(Object.keys(defaults).map(k => [k, "not-a-number"]))], ["empty", {}], ["null", null], ["argument access", defaults], ["throwing argument getter", defaults]];
      for (const field of panel?.fields || []) for (const option of field.options?.menu_generator_advanced || []) variants.push([`menu ${field.name}=${option[1]}`, { ...defaults, [field.name]: option[1] }]);
      for (const [label, args] of variants) {
        const argumentReads = [], timeline = ["call"], actionStart = actionCalls.length, errorStart = errorCalls.length;
        const entry = { name, label, args, argumentReads, timeline };
        const observed = label === "argument access" || label === "throwing argument getter" ? new Proxy(args, { get(target, key) { argumentReads.push(String(key)); if (label === "throwing argument getter") throw new Error("probe getter " + String(key)); return target[key]; } }) : args;
        try {
          const value = functions[name](observed, "probe", "probe-actor", {}, "probe", {});
          entry.promise = value instanceof Promise;
          timeline.push("returned");
          if (entry.promise) {
            const settled = value.then(result => { timeline.push("fulfilled"); return { result: encode(result) }; }, error => { timeline.push("rejected"); return { error: String(error), errorPhase: "rejection" }; });
            queueMicrotask(() => timeline.push("queued microtask"));
            Object.assign(entry, await settled);
          } else entry.result = encode(value);
        } catch (error) { entry.error = String(error); entry.errorPhase = "synchronous throw"; timeline.push("threw"); }
        entry.sideEffects = { runtimeActions: actionCalls.length - actionStart, domainErrors: errorCalls.length - errorStart, hardwareIds: [...hardware.hardwareMap.keys()] };
        cases.push(entry);
      }
    }
    } finally { runtime.send_action = originalSendAction; errors.addError = originalAddError; }
    const core = req(70324).Z;
    return {
      version: req(91107).BcmInstance.getBcm().version,
      hardwareIds: [...hardware.hardwareMap.keys()], hasMicrobit: hardware.isHardwareExists("microbit"),
      configs, panels, cases,
      actionSpecs: req(47252).P().get_action_specs(),
      moduleSources: Object.fromEntries([20592, 47252, 70324, 87282].map(id => [id, String(req.m[id])])),
      factorySource: String(req(20592).d), blockNames: req(47038).k,
      coreSources: Object.fromEntries(Object.getOwnPropertyNames(core.prototype).filter(n => n !== "constructor" && typeof core.prototype[n] === "function").map(n => [n, String(core.prototype[n])])),
      functionSources: Object.fromEntries(Object.entries(functions).map(([name, fn]) => [name, String(fn)])),
      hardwareExports: Object.keys(hardware),
      hardwareSources: Object.fromEntries(Object.entries(hardware).filter(([, fn]) => typeof fn === "function").map(([name, fn]) => [name, String(fn)])),
    };
  });
} catch (error) { report.failure = error.stack; }
finally { await browser.close(); }
report.sourceLocations = [];
const sources = report.editor?.moduleSources || {};
const anchor = async (symbol, source) => {
  for (const bundle of report.bundles) {
    const text = await fs.readFile(`${out}/${bundle.name}`, "utf8"), index = text.indexOf(source);
    if (index < 0) continue;
    const entry = { symbol, bundle: bundle.name, bundleUrl: bundle.url, bundleSha256: bundle.sha256, byteOffset: Buffer.byteLength(text.slice(0, index)), excerptCharacters: source.length, excerptSha256: sha256(source) };
    report.sourceLocations.push(entry);
    return entry;
  }
  throw new Error("Cannot anchor official source: " + symbol);
};
try {
  for (const [id, source] of Object.entries(sources)) await anchor(`module:${id}`, source);
  for (const [key, name] of Object.entries(report.editor?.blockNames || {})) {
    if (!name.startsWith("microbit_") || !report.editor.functionSources[name]) continue;
    const source = sources[20592], marker = `(0,n.Z)(e,l.k.${key},`, start = source.indexOf(marker);
    if (start < 0) throw new Error("Cannot find domain registration: " + name);
    const end = source.indexOf("(0,n.Z)(e,l.k.", start + marker.length);
    await anchor(name, source.slice(start, end < 0 ? source.indexOf(",e);return t}", start) : end));
  }
  for (const method of ["onConnect", "startNotification", "startNotificationWeb", "start", "emitEvent"]) {
    const source = sources[70324], marker = `{key:"${method}",value:`, start = source.indexOf(marker), end = source.indexOf("},{key:", start + marker.length);
    if (start < 0 || end < start) throw new Error("Cannot find core method: " + method);
    await anchor(`core:${method}`, source.slice(start, end + 1));
  }
  for (const name of ["handleNotification", "handlePinData", "handleUARTMessage"]) {
    const source = sources[70324], start = source.indexOf(`n.${name}=function`), end = source.indexOf("},n.", start);
    if (start < 0 || end < start) throw new Error("Cannot find notification producer: " + name);
    await anchor(`core:${name}`, source.slice(start, end + 1));
  }
  await anchor("hardware:guard", report.editor.hardwareSources.getHardwareCoreAndCheck);
} catch (error) { report.failure = error.stack; }
const remainingCatalog = catalogTypes.filter(n => n.startsWith("microbit_") && !["microbit_led_is_plot", "microbit_button_is_pressed", "microbit_pin_digital_read", "microbit_pin_analog_read", "microbit_logo_is_pressed", "microbit_is_gesture", "microbit_math_map"].includes(n));
const synchronous = new Set(["microbit_change_bpm", "microbit_set_bpm", "microbit_get_volume", "microbit_pin_is_pressed"]);
const sensors = new Set(["microbit_temperature", "microbit_light_level", "microbit_sound_level", "microbit_accelerometer", "microbit_rotation", "microbit_magnetometer", "microbit_compass_heading"]);
const earlyReads = new Set(["microbit_pin_set_touch_mode", "microbit_led_show_custom", "microbit_accelerometer", "microbit_rotation", "microbit_magnetometer", "microbit_pin_is_pressed"]);
report.checks = {
  noHardware: report.editor?.hasMicrobit === false && report.editor.hardwareIds.length === 0,
  remainingCatalogClassified: remainingCatalog.length === 31 && remainingCatalog.every(n => report.editor?.panels.some(p => p.name === n) && (report.editor.cases.some(c => c.name === n) || report.editor.actionSpecs.some(a => a.id === n))),
  noRuntimeActionsOrDomainErrors: !!report.editor?.cases.length && report.editor.cases.every(c => c.sideEffects.runtimeActions === 0 && c.sideEffects.domainErrors === 0 && c.sideEffects.hardwareIds.length === 0),
  actualTypedResults: !!report.editor?.cases.length && report.editor.cases.every(c => {
    if (earlyReads.has(c.name) && ["null", "throwing argument getter"].includes(c.label)) return !!c.error && c.errorPhase === (synchronous.has(c.name) ? "synchronous throw" : "rejection");
    const expected = sensors.has(c.name) ? { type: "number", value: "NaN" } : c.name === "microbit_pin_is_pressed" ? { type: "boolean", value: false } : { type: "undefined" };
    return !c.error && c.promise === !synchronous.has(c.name) && JSON.stringify(c.result) === JSON.stringify(expected);
  }),
  allSourcesAnchored: report.sourceLocations.length === 51,
  noUncaughtPageErrors: report.pageErrors.length === 0,
};
report.ok = !report.failure && Object.values(report.checks).every(Boolean);
await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
if (process.argv.includes("--record") && report.ok) {
  const blocks = report.editor.panels.filter(p => remainingCatalog.includes(p.name) || p.name === "microbit_servo_set_pulse").map(panel => {
    const cases = report.editor.cases.filter(c => c.name === panel.name), baseline = cases.find(c => c.label === "defaults");
    return { ...panel, inCatalog: remainingCatalog.includes(panel.name), classification: panel.kind === "event" ? "unsupported-event-no-native-scheduling-evidence" : baseline.promise ? "unsupported-promise-no-native-scheduling-evidence" : "synchronous-disconnected-candidate", promise: baseline?.promise, result: baseline?.result, argumentReads: cases.find(c => c.label === "argument access")?.argumentReads, cases, source: report.sourceLocations.find(s => s.symbol === panel.name) || report.sourceLocations.find(s => s.symbol === "module:47252") };
  });
  const summary = {
    schema: report.schema, checkedAt: report.checkedAt, version: report.editor.version,
    editorUrl: report.editorUrl, probe: "tools/compat/kn-hardware-remaining-probe.mjs", fullLocalReport: `${out}/report.json`,
    method: "Actual official lazy extension domain calls, original empty hardware map and connection guard. Forwarding observers on runtime send_action and domain addError are restored after calls. No device connected and no synthetic hardware event sent.",
    hardwareIds: report.editor.hardwareIds, hasMicrobit: report.editor.hasMicrobit,
    remainingCatalog, caseCount: report.editor.cases.length, checks: report.checks, pageErrors: report.pageErrors,
    blocks, extraDomains: ["microbit_pin_is_pressed", "microbit_servo_set_angle_360"].map(name => ({ name, inCurrentPanel: false, inCatalog: false, classification: "unsupported-domain-only", cases: report.editor.cases.filter(c => c.name === name), source: report.sourceLocations.find(s => s.symbol === name) })),
    events: { actionSpecs: report.editor.actionSpecs, naturalDisconnectedReachability: "No hardware core exists in the measured map, so no notification producer is installed. Specs alone do not emit actions. Manual runtime send_action or direct core method invocation is outside this profile; emitEvent itself has no connection guard.", sources: report.sourceLocations.filter(s => /^(core:|module:47252)/.test(s.symbol)) },
    sideEffects: { runtimeActions: 0, domainErrors: 0, hardwareMapEmptyAfterEveryCall: true, guardCaveat: "The original guard can open a warning toast once per runtimeId and updates its private warning-deduplication state; these calls are not globally side-effect-free. No hardware methods are reachable after an empty-map guard." },
    sourceLocations: report.sourceLocations, bundles: report.bundles.filter(b => report.sourceLocations.some(s => s.bundle === b.name)),
    limitations: ["Direct official domain calls, not native project execution or proof of child-expression evaluation order.", "inputs is official args0 value-socket order, not domain getter order; child values must still be evaluated by callers.", "Promise scheduling is only the local JS microtask observation. No full native scheduling equivalence claimed.", "Connected devices, other hardware families and synthetic runtime events are out of scope.", "No Rust implementation or coverage table changes made."],
  };
  await fs.writeFile("docs/kn-hardware-remaining-evidence.json", JSON.stringify(summary, null, 2) + "\n");
}
if (!report.ok) process.exitCode = 1;
console.log(JSON.stringify({ ok: report.ok, failure: report.failure, checks: report.checks, caseCount: report.editor?.cases.length, sourceCount: report.sourceLocations.length }, null, 2));
