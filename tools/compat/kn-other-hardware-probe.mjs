#!/usr/bin/env node
// Independent authored oracle. Official bundles and function bodies stay in ignored dist/.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const out = "dist/kn-other-hardware";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const hardwareTypes = ["catbit_button_is_pressed", "catbit_button_when", "catbit_usb_button_when", "change_robot2_master_motor_power", "change_robot_master_motor_power", "get_robot2_master_motor_power", "get_robot_master_infrared_sensor_distance", "get_robot_master_motor_power", "set_robot2_master_motor_power_rotation", "set_robot2_master_motor_power_rotation_duration", "set_robot_master_light_color", "set_robot_master_light_color_duration", "set_robot_master_motor_power_rotation", "set_robot_master_motor_power_rotation_duration", "stop_robot2_master_motor", "stop_robot_master_light", "stop_robot_master_motor", "wand_button_is_pressed", "wand_coordinate", "wand_direction_when", "wand_reset_position", "wand_rotation"];
export function implementationBoundary(panel) {
  return panel.kind === "reporter" ? "synchronous-disconnected-reporter-candidate" : panel.kind === "command" ? "defer-promise-scheduler-unproven" : "defer-event-dispatch-unproven";
}

async function main() {
  const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES || `${out}/deps/node_modules`, "package.json"));
  const { chromium } = require("playwright");
  await fs.mkdir(out, { recursive: true });
  const panelEvidence = JSON.parse(await fs.readFile("docs/kn-panel-evidence.json", "utf8"));
  const registeredTypes = panelEvidence.typeGroups["registered-not-in-audited-panels"];
  const report = { schema: "nekoc-kn-other-hardware-v1", checkedAt: new Date().toISOString(), editorUrl: "https://kn.codemao.cn/editor", method: "Fresh anonymous official Edge; expose webpack loader, load five actual lazy extension modules without installing or connecting hardware, call unchanged official domain factories and event predicates, inspect official panels and registration, convert authored code using official code-view converter. Read local VM branch names without changing Rust.", limitations: ["Empty hardware map only; connected devices and installed-but-disconnected cores were not measured.", "Direct domain calls are not native project execution. Promise fulfillment does not establish native scheduling; all commands remain deferred.", "Event specs and isolated predicates are not live event-dispatch tests. No device events were injected into a running project.", "Panel argument order is not a proof of child-expression VM evaluation order. Domain property reads do not authorize input elision.", "A local exact-name VM branch proves a path exists, not semantic completeness. Registration and code conversion do not prove playback behavior.", "The 41 registered types are existing VM paths, not new missing features; negative converter results do not establish unreachability."], bundles: [], pageErrors: [] };
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
    report.editor = await page.evaluate(async ({ hardwareTypes, registeredTypes }) => {
      const req = window.__nekocRequire;
      for (const name of ["./catbit", "./catbitUsb", "./wand", "./tudao", "./tudao2"]) await req(91136)(name);
      const hardware = req(87282), blink = req(40742).BlinkInstance;
      const runtime = req(26921).cG.get_instance(), registry = runtime.getHeart().core.get_registry();
      const functions = { ...req(62392).i(), ...req(53026).S({ runtime }), ...req(47872).N(), ...req(84622).m() };
      const configs = [...req(83710).CATBIT_BLOCKS, ...req(49403).CATBIT_USB_BLOCKS, ...req(11038).WAND_BLOCKS, ...req(40130).TUDAO_BLOCKS, ...req(8892).TUDAO2_BLOCKS];
      const encode = value => ({ type: typeof value, ...(value === undefined ? {} : { value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value }) });
      const bodies = [], panels = [], cases = [];
      const invoke = async (name, label, args, argumentReads) => {
        let value;
        try { value = functions[name](args, "probe", "probe-actor", {}, "probe", {}); }
        catch (error) { return { name, label, argumentReads, boundary: "synchronous-throw", error: String(error) }; }
        const promise = !!value?.then;
        try { return { name, label, argumentReads, promise, boundary: promise ? "promise-fulfilled" : "synchronous-return", result: encode(promise ? await value : value) }; }
        catch (error) { return { name, label, argumentReads, promise, boundary: "promise-rejected", error: String(error) }; }
      };
      for (const name of hardwareTypes) {
        const config = configs.find(b => b.type === name);
        if (!config) throw new Error("No official panel: " + name);
        const args = (config.args0 || []).filter(a => a.name);
        const defaults = Object.fromEntries(args.map(a => [a.name, a.defaultValue ?? a.options?.menu_generator_advanced?.[a.options?.selected_index || 0]?.[1] ?? a.value ?? a.colour ?? "probe"]));
        panels.push({ name, kind: config.output ? "reporter" : config.previousStatement ? "command" : "event", output: config.output || null, inputs: args.filter(a => a.type === "input_value").map(a => a.name), argumentOrder: args.map(a => a.name), defaults, fields: args.filter(a => a.type !== "input_value").map(a => ({ name: a.name, type: a.type, options: a.options?.menu_generator_advanced?.map(o => o[1]) })) });
        if (!functions[name]) continue;
        bodies.push({ symbol: name, body: String(functions[name]) });
        const variants = [["panel defaults", defaults], ["invalid", Object.fromEntries(args.map(a => [a.name, "not-a-number"]))], ["empty", Object.fromEntries(args.map(a => [a.name, ""]))]];
        for (const a of args) for (const option of a.options?.menu_generator_advanced || []) variants.push(["menu " + a.name + "=" + option[1], { ...defaults, [a.name]: option[1] }]);
        for (const [label, values] of variants) cases.push({ ...await invoke(name, label, values), args: values });
        for (const throwing of [false, true]) {
          const reads = [], observed = new Proxy(defaults, { get(target, key) { reads.push(String(key)); if (throwing) throw new Error("probe getter " + String(key)); return target[key]; } });
          cases.push(await invoke(name, throwing ? "throwing getters" : "argument access", observed, reads));
        }
        cases.push(await invoke(name, "null arguments", null));
      }
      const events = [];
      for (const [moduleId, key] of [[60548, "v"], [81794, "r"], [18541, "v"]]) {
        bodies.push({ symbol: "event-factory-" + moduleId, body: String(req.m[moduleId]), moduleId });
        for (const spec of req(moduleId)[key]({ runtime }).get_action_specs()) {
          if (!hardwareTypes.includes(spec.id)) continue;
          const responder = spec.responder_blocks[0], calls = [];
          if (responder.trigger_function) for (const value of [undefined, [], [{ id: spec.id, sub_type: "0", value: "click" }], [{ id: "unrelated", sub_type: "0", value: "click" }]]) calls.push({ actionData: encode(value), result: encode(responder.trigger_function(value, "click", "0")) });
          events.push({ name: spec.id, moduleId, entitySpecific: spec.entity_specific, responderType: responder.type, async: responder.async, filterArguments: responder.filter_arg_names, statefulness: spec.statefulness || null, hasTriggerFunction: !!responder.trigger_function, calls });
        }
      }
      const converter = req(58890), declarations = req(96733).ZH();
      const authoredPrograms = ["let audit = [1, 2]; audit[0] = 3; console_log(audit[0]);", "let audit = { x: 1 }; audit.x = 2; console_log(audit.x);", "let audit = 1; audit++; audit--; audit += 2; audit -= 2; audit *= 2; audit /= 2; audit %= 2;", "while (true) { if (true) break; continue; }", "function audit() { return 4; }", "console_log(true ? 1 : 2);", "console_log(!!1);", "on_collision_with_sprite('enter', '--any', value => { console_log(value); });", "on_broadcast_received_with_content('audit', value => { console_log(value); });", "repeat_for_range(1, 3, 1, value => { console_log(value); });", "get_sprite_property('--self', 'x');", "get_sprite_property('--self', 'size');", "get_sprite_property('--self', 'color');", "script_variables_get('audit');", "setTimeout(() => { console_log(1); }, 10);", "setInterval(() => { console_log(1); }, 10);"];
      for (const name of registeredTypes.filter(n => !n.startsWith("_") && !n.startsWith("math_") && !n.endsWith("_value") && !n.endsWith("_param"))) authoredPrograms.push(`${name}(1);`);
      authoredPrograms.push("math_trig_rad('sin', 1);");
      const conversions = authoredPrograms.map(code => { const result = converter._j(code); const xml = new DOMParser().parseFromString(result.xml, "text/xml"); return { code, types: [...new Set([...xml.querySelectorAll("block,shadow")].map(b => b.getAttribute("type")))], errors: result.errors, warnings: result.warnings }; });
      const baseConversions = ["function audit() { return 4; }"].map(code => { const result = req(96733)._j(code); const xml = new DOMParser().parseFromString(result.xml, "text/xml"); return { code, types: [...new Set([...xml.querySelectorAll("block,shadow")].map(b => b.getAttribute("type")))], errors: result.errors, warnings: result.warnings }; });
      const rows = [];
      blink.core.events.disable();
      try {
        for (const name of [...registeredTypes, "get_sprite_property"]) {
          const row = { name, definitionRegistered: !!blink.core.Blocks[name], domainIndex: registry.get_domain_function_index(name) ?? null, declarationPresent: !!declarations[name], declarations: Object.entries(declarations).filter(([key, v]) => key === name || v?.type === name).map(([key, v]) => ({ key, type: v.type, callee: v.callee, kind: v.kind, params: v.params?.map(p => ({ name: p.name, type: p.paramType })), returnType: v.returnType })), conversions: conversions.filter(c => c.types.includes(name)).map(c => ({ code: c.code, errorCount: c.errors.length })) };
          let block;
          try {
            block = blink.core.mainWorkspace.new_block(name); row.constructed = true; row.inputs = block.inputList?.map(i => ({ name: i.name, fields: i.fieldRow?.map(f => ({ name: f.name, value: f.getValue?.() })).filter(f => f.name) }));
          }
          catch (error) { row.constructed = false; row.error = String(error); }
          finally { block?.dispose(); }
          rows.push(row);
        }
      } finally { blink.core.events.enable(); }
      for (const name of registeredTypes) {
        const referencePattern = new RegExp("\\b" + name + "\\b");
        const candidates = Object.entries(req.m).filter(([, f]) => referencePattern.test(String(f))).sort((a, b) => String(a[1]).length - String(b[1]).length);
        const [id, fn] = candidates[0] || [];
        if (fn) { rows.find(r => r.name === name).referenceModule = Number(id); bodies.push({ symbol: "registered-reference-" + name, moduleId: Number(id), body: String(fn) }); }
      }
      for (const id of [91136, 62392, 53026, 47872, 84622, 87282, 58890, 96733, 83710, 49403, 11038, 40130, 8892]) bodies.push({ symbol: "module-" + id, body: String(req.m[id]), moduleId: id });
      return { version: req(91107).BcmInstance.getBcm().version, hardwareIds: [...hardware.hardwareMap.keys()], panels, cases, events, registeredAudit: { rows, conversions, baseConversions }, bodies };
    }, { hardwareTypes, registeredTypes });
  } catch (error) { report.failure = error.stack; }
  finally { await browser.close(); }
  report.sourceLocations = [];
  for (const { symbol, body, moduleId } of report.editor?.bodies || []) {
    for (const bundle of report.bundles) {
      const text = await fs.readFile(`${out}/${bundle.name}`, "utf8");
      const index = text.indexOf(moduleId ? `${moduleId}:${body}` : body);
      if (index < 0) continue;
      const excerpt = moduleId ? `${moduleId}:${body}` : body;
      report.sourceLocations.push({ symbol, ...(moduleId ? { moduleId } : {}), bundle: bundle.name, bundleSha256: bundle.sha256, byteOffset: Buffer.byteLength(text.slice(0, index)), excerptCharacters: excerpt.length, excerptSha256: sha256(excerpt) });
      break;
    }
  }
  const vmBytes = await fs.readFile("src/engine.rs"), vmLines = vmBytes.toString("utf8").split("\n");
  report.vmAudit = { path: "src/engine.rs", sha256: sha256(vmBytes), rows: registeredTypes.map(name => ({ name, explicitNameLines: vmLines.flatMap((line, i) => line.includes(JSON.stringify(name)) ? [i + 1] : []), conclusion: "existing-explicit-vm-path-not-new-missing-feature" })) };
  report.checks = {
    noHardware: report.editor?.hardwareIds.length === 0,
    all22Panels: report.editor?.panels.length === 22,
    sevenSynchronousReporters: report.editor?.panels.filter(p => p.kind === "reporter").length === 7 && report.editor.panels.filter(p => p.kind === "reporter").every(p => { const c = report.editor.cases.find(c => c.name === p.name && c.label === "panel defaults"); return c?.promise === false && c.boundary === "synchronous-return" && (p.output === "Boolean" ? c.result.type === "boolean" && c.result.value === false : c.result.type === "number" && c.result.value === "NaN"); }),
    twelvePromiseCommands: report.editor?.panels.filter(p => p.kind === "command").length === 12 && report.editor.panels.filter(p => p.kind === "command").every(p => report.editor.cases.filter(c => c.name === p.name).every(c => c.promise === true && c.boundary === "promise-fulfilled" && c.result.type === "undefined")),
    threeEventSpecs: report.editor?.events.length === 3 && report.editor.events.every(e => e.async === false),
    all41RegisteredAndExistingVmPaths: report.editor?.registeredAudit.rows.filter(r => registeredTypes.includes(r.name)).every(r => r.definitionRegistered && r.constructed) && report.vmAudit.rows.every(r => r.explicitNameLines.length > 0),
    apiAliasNotRegistered: report.editor?.registeredAudit.rows.find(r => r.name === "get_sprite_property")?.definitionRegistered === false && report.editor.registeredAudit.rows.find(r => r.name === "get_sprite_property")?.constructed === false,
    sourceAnchorsFound: report.sourceLocations.length === report.editor?.bodies.length,
    noPageErrors: report.pageErrors.length === 0,
  };
  report.ok = !report.failure && Object.values(report.checks).every(Boolean);
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
  if (process.argv.includes("--record") && report.ok) {
    const { bodies, ...editor } = report.editor;
    const summary = { ...report, editor: { ...editor, panels: editor.panels.map(p => ({ ...p, implementationBoundary: implementationBoundary(p) })) } };
    await fs.writeFile("docs/kn-other-hardware-evidence.json", JSON.stringify(summary, null, 2) + "\n");
  }
  if (!report.ok) process.exitCode = 1;
  console.log(JSON.stringify({ ok: report.ok, failure: report.failure, checks: report.checks, caseCount: report.editor?.cases.length, sourceCount: report.sourceLocations.length, expectedSources: report.editor?.bodies.length, registeredConversionCount: report.editor?.registeredAudit.rows.filter(r => registeredTypes.includes(r.name) && r.conversions.some(c => c.errorCount === 0)).length }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
