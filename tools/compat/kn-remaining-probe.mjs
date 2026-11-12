#!/usr/bin/env node
// Authored official-only oracle. Vendor code and projects stay in ignored dist/.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPlaywright } from "../probe-kitten4.mjs";

const out = "dist/kn-remaining-official";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const coverage = await fs.readFile("docs/kn-block-coverage.md", "utf8");
// Frozen from the 45 missing rows on entry to this task, so implementation/coverage
// updates do not silently reduce this oracle's target set. No third-party kernel.
const names = ["catbit_button_when", "catbit_usb_button_when", "change_robot2_master_motor_power", "change_robot_master_motor_power", "get_sprite_property", "get_voice_volume", "microbit_accelerometer", "microbit_button_when", "microbit_compass_heading", "microbit_led_clear", "microbit_led_plot", "microbit_led_plot_graph", "microbit_led_show_custom", "microbit_led_show_icon", "microbit_led_show_number", "microbit_led_show_text", "microbit_led_toggle", "microbit_led_unplot", "microbit_light_level", "microbit_logo_when", "microbit_magnetometer", "microbit_pause_by_beats", "microbit_pin_analog_write", "microbit_pin_digital_write", "microbit_pin_set_touch_mode", "microbit_pin_when", "microbit_play_melody", "microbit_play_tone_by_beats", "microbit_rotation", "microbit_servo_set_angle_270", "microbit_set_volume", "microbit_sound_level", "microbit_stop", "microbit_temperature", "set_robot2_master_motor_power_rotation", "set_robot2_master_motor_power_rotation_duration", "set_robot_master_light_color", "set_robot_master_light_color_duration", "set_robot_master_motor_power_rotation", "set_robot_master_motor_power_rotation_duration", "stop_robot2_master_motor", "stop_robot_master_light", "stop_robot_master_motor", "wand_direction_when", "wand_reset_position"];
if (names.length !== 45) throw new Error(`Expected 45 missing rows, got ${names.length}`);
await fs.mkdir(out, { recursive: true });
const report = { schema: "nekoc-kn-remaining-official-v1", checkedAt: new Date().toISOString(), editorUrl: "https://kn.codemao.cn/editor", targetOrigin: "45 missing rows in docs/kn-block-coverage.md on task entry; names frozen independently of later implementation", currentCoverageSha256: hash(coverage), names, bundles: [], pageErrors: [] };
const browser = await loadPlaywright().chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", e => report.pageErrors.push(e.message));
  await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body();
    const url = route.request().url(), name = path.basename(new URL(url).pathname);
    await fs.writeFile(`${out}/${name}`, bytes);
    report.bundles.push({ name, url, bytes: bytes.length, sha256: hash(bytes) });
    const body = name.startsWith("main.") ? bytes.toString("utf8").replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") : bytes;
    await route.fulfill({ response, body });
  });
  const baseProject = JSON.parse(await fs.readFile("tests/fixtures/kn-async-services/timers.bcmkn", "utf8"));
  baseProject.projectName = "NekoC remaining official scheduler";
  baseProject.actors.actorsDict["nekoc-default-actor"].nekoBlockJsonList = [];
  const fixtureUrl = "https://kn.codemao.cn/__nekoc_remaining__.bcmkn";
  await page.route(fixtureUrl, route => route.fulfill({ contentType: "application/json", body: JSON.stringify(baseProject) }));
  await page.goto(report.editorUrl + "?previewUrl=" + encodeURIComponent(fixtureUrl), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  report.editor = await page.evaluate(async names => {
    const req = window.__nekocRequire;
    await Promise.all([1359, 5337, 8205, 2308].map(id => req.e(id)));
    req(83939);
    for (const name of ["./catbit", "./catbitUsb", "./wand", "./tudao", "./tudao2"]) await req(91136)(name);
    const runtime = req(26921).cG.get_instance(), core = runtime.getHeart().core, registry = core.get_registry();
    const hardware = req(87282), store = req(69138).default;
    const functions = { ...req(20592).d(), ...req(62392).i(), ...req(53026).S({ runtime }), ...req(47872).N(), ...req(84622).m() };
    const configs = [...req(66111).MICROBIT_BLOCKS, ...Object.values(req(66111).MICROBIT_SHORT_BLOCKS).flat(), ...req(83710).CATBIT_BLOCKS, ...req(49403).CATBIT_USB_BLOCKS, ...req(11038).WAND_BLOCKS, ...req(40130).TUDAO_BLOCKS, ...req(8892).TUDAO2_BLOCKS];
    const encode = value => ({ type: typeof value, ...(value === undefined ? {} : { value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value }) });
    const bodies = [20592, 47252, 70324, 87282, 62392, 53026, 47872, 84622, 60548, 81794, 18541, 58890, 96733, 91789, 40989].map(id => ({ symbol: `module:${id}`, moduleId: id, body: String(req.m[id]) }));
    const events = [req(47252).P(), req(60548).v({ runtime }), req(81794).r({ runtime }), req(18541).v({ runtime })].flatMap(factory => factory.get_action_specs()).filter(s => names.includes(s.id));
    const panels = names.map(name => {
      const c = configs.find(c => c.type === name);
      const args = (c?.args0 || []).filter(a => a.name);
      const defaults = Object.fromEntries(args.map(a => [a.name, a.defaultValue ?? a.options?.menu_generator_advanced?.[a.options.selected_index || 0]?.[1] ?? a.value ?? a.colour ?? "probe"]));
      return { name, kind: c ? c.output ? "reporter" : c.previousStatement ? "command" : "event" : name === "get_sprite_property" ? "code-api" : "reporter", output: c?.output, inputs: args.filter(a => a.type === "input_value").map(a => a.name), fields: args.filter(a => a.type !== "input_value").map(a => ({ name: a.name, options: a.options?.menu_generator_advanced?.map(o => o[1]) })), defaults, domainIndex: registry.get_domain_function_index(name) ?? null, definitionRegistered: !!req(40742).BlinkInstance.core.Blocks[name] };
    });
    const manager = core.get_runtime_manager(), actions = [], errors = [];
    const originalSend = manager.send_action;
    manager.send_action = function(action, ...rest) { actions.push({ id: action.id }); return originalSend.call(this, action, ...rest); };
    const errorManager = req(31152).x.get_instance(), originalError = errorManager.addError;
    errorManager.addError = function(error, ...rest) { errors.push({ type: typeof error }); return originalError.call(this, error, ...rest); };
    const cases = [];
    try {
      for (const panel of panels.filter(p => functions[p.name])) {
        const variants = [["defaults", panel.defaults], ["invalid", Object.fromEntries(Object.keys(panel.defaults).map(k => [k, "not-a-number"]))], ["empty", {}], ["null", null], ["argument access", panel.defaults], ["throwing getter", panel.defaults]];
        for (const f of panel.fields) for (const value of f.options || []) variants.push([`menu ${f.name}=${value}`, { ...panel.defaults, [f.name]: value }]);
        for (const [label, args] of variants) {
          const reads = [], timeline = ["call"], a = actions.length, e = errors.length;
          const entry = { name: panel.name, label, args, reads, timeline };
          const observed = label.includes("getter") || label === "argument access" ? new Proxy(args, { get(target, key) { reads.push(String(key)); if (label === "throwing getter") throw new Error(`probe getter ${String(key)}`); return target[key]; } }) : args;
          try {
            const value = functions[panel.name](observed, "remaining-probe", "probe-actor", {}, "remaining-probe", {});
            entry.promise = value instanceof Promise;
            timeline.push("returned");
            if (entry.promise) {
              const settled = value.then(v => { timeline.push("fulfilled"); return { result: encode(v) }; }, e => { timeline.push("rejected"); return { error: String(e), errorPhase: "rejection" }; });
              queueMicrotask(() => timeline.push("queued microtask"));
              Object.assign(entry, await settled);
            } else entry.result = encode(value);
          } catch (e) { entry.error = String(e); entry.errorPhase = "synchronous throw"; timeline.push("threw"); }
          entry.sideEffects = { actions: actions.length - a, domainErrors: errors.length - e, hardwareIds: [...hardware.hardwareMap.keys()] };
          cases.push(entry);
        }
      }
      const voice = registry.domain_function_list[registry.get_domain_function_index("get_voice_volume")];
      // Registry wraps this function; anchor its defining module below instead of claiming a raw-body match.
      const initialRecordEnable = store.runtimeStore.recordEnable;
      const setter = value => typeof store.runtimeStore.setRecordEnable === "function" ? store.runtimeStore.setRecordEnable(value) : store.runtimeStore.recordEnable = value;
      // Fresh browser, no permissions granted. Observe a finite window, never call a pending result zero.
      for (const branch of ["fresh-default", "record-disabled"]) {
        if (branch === "record-disabled") setter(false);
        const entry = { name: "get_voice_volume", label: branch, recordEnable: store.runtimeStore.recordEnable, timeline: ["call"] };
        try {
          const value = voice({}, "remaining-probe", "probe-actor", "probe-actor", "remaining-probe", {});
          if (branch === "fresh-default") window.__remainingVoiceDefault = value;
          entry.promise = value instanceof Promise; entry.timeline.push("returned");
          const result = value?.then ? value.then(v => { entry.timeline.push("fulfilled"); return { result: encode(v) }; }, e => { entry.timeline.push("rejected"); return { error: String(e), errorPhase: "rejection" }; }) : Promise.resolve({ result: encode(value) });
          Object.assign(entry, await Promise.race([result, new Promise(resolve => setTimeout(() => resolve({ pendingAfterMs: 3000 }), 3000))]));
        } catch (e) { entry.error = String(e); entry.errorPhase = "synchronous throw"; }
        entry.microphone = { permission: encode(req(91789).Bj.get_instance().getPermission()), isRunning: req(91789).Bj.get_instance().core.isRunning, volume: encode(req(91789).Bj.get_instance().core.volume) };
        cases.push(entry);
      }
      setter(initialRecordEnable);
    } finally { manager.send_action = originalSend; errorManager.addError = originalError; }
    const converter = req(58890), declaration = req(96733).ZH().get_sprite_property;
    const conversions = [];
    for (const property of ["x", "y", "size", "scale", "width", "height", "direction", "style", "style_index", "visible", "alpha", "color", "opacity", "brightness", "pixelate", "ripple", "distortion", "grayscale", "distance", "camp", "not-a-property"]) {
      const code = `console_log(get_sprite_property('--self', '${property}'));`;
      try {
        const result = converter._j(code), xml = new DOMParser().parseFromString(result.xml, "text/xml");
        conversions.push({ property, code, errors: result.errors, warnings: result.warnings, types: [...new Set([...xml.querySelectorAll("block,shadow")].map(b => b.getAttribute("type")))], fields: [...xml.querySelectorAll("field")].map(f => ({ name: f.getAttribute("name"), value: f.textContent })), xml: result.xml });
      } catch (e) { conversions.push({ property, code, error: String(e) }); }
    }
    const voiceModules = Object.entries(req.m).filter(([, f]) => /getVoiceVolume,function|startVolume|recordEnable|setRecordEnable/.test(String(f))).map(([id, fn]) => ({ symbol: `voice-module:${id}`, moduleId: Number(id), body: String(fn) }));
    bodies.push(...voiceModules);
    window.__remainingPanels = panels;
    const voiceVolumeTransform = [-100, 0, 1, 14, 35, 49, 70, 100, Infinity, -Infinity, NaN, "35", null, undefined].map(value => ({ input: encode(value), result: encode(req(40989).K9(value)) }));
    return { version: req(91107).BcmInstance.getBcm().version, hardwareIds: [...hardware.hardwareMap.keys()], panels, cases, events, conversions, declaration, voiceVolumeTransform, voiceEnvironment: { mobile: req(11937).pj(), pcClient: req(11937).wL(), specialPlayer: req(11937).nc() }, bodies, actions, errors, registryNames: Object.keys(registry.domain_function_index).filter(n => names.includes(n)) };
  }, names);
  report.permissionDialog = await page.evaluate(() => {
    const s = window.__nekocRequire(69138).default.ComponentsStore.PermissionModalStore;
    return { text: document.body.innerText.slice(-2200), keys: Object.keys(s), methods: Object.getOwnPropertyNames(Object.getPrototypeOf(s)).filter(k => typeof s[k] === "function").map(k => ({ name: k, body: String(s[k]) })) };
  });
  // Distinguish the editor's consent modal from the browser microphone policy.
  await page.getByText(/^暂不授权$/).last().dispatchEvent("click");
  report.voicePermission = { modalDenied: await page.evaluate(async () => {
    const req = window.__nekocRequire;
    const outcome = await Promise.race([window.__remainingVoiceDefault.then(v => ({ promise: true, result: { type: typeof v, value: Number.isNaN(v) ? "NaN" : v } }), e => ({ error: String(e) })), new Promise(resolve => setTimeout(() => resolve({ pendingAfterMs: 3000 }), 3000))]);
    return { ...outcome, permission: req(91789).Bj.get_instance().getPermission(), volume: req(91789).Bj.get_instance().core.volume, isRunning: req(91789).Bj.get_instance().core.isRunning };
  }) };
  // Set a real browser permission policy; do not fake getUserMedia or provide a device.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Browser.setPermission", { permission: { name: "microphone" }, setting: "denied", origin: "https://kn.codemao.cn" });
  await page.evaluate(async () => {
    const req = window.__nekocRequire, recorder = req(91789).Bj.get_instance();
    await recorder.stopListening();
    req(69138).default.runtimeStore.recordEnable = true;
    const registry = req(26921).cG.get_instance().getHeart().core.get_registry();
    window.__remainingVoicePermission = { gum: [], errors: [] };
    const obs = window.__remainingVoicePermission;
    const media = navigator.mediaDevices, original = media.getUserMedia;
    obs.originalGum = original;
    media.getUserMedia = function(constraints) {
      const entry = { audio: !!constraints.audio }; obs.gum.push(entry);
      const promise = original.call(this, constraints);
      promise.then(() => entry.fulfilled = true, e => { entry.errorName = e.name; entry.errorMessage = e.message; });
      return promise;
    };
    const errors = req(31152).x.get_instance(); obs.originalError = errors.addError;
    errors.addError = function(error, ...rest) { obs.errors.push({ type: typeof error }); return obs.originalError.call(this, error, ...rest); };
    const value = registry.domain_function_list[registry.get_domain_function_index("get_voice_volume")]({}, "remaining-browser-denied", "nekoc-default-actor", "nekoc-default-actor", "remaining-browser-denied", {});
    obs.promise = value.then(v => ({ promise: true, result: { type: typeof v, value: Number.isNaN(v) ? "NaN" : v } }), e => ({ error: String(e) }));
  });
  await page.getByText(/^同意授权$/).last().dispatchEvent("click");
  report.voicePermission.browserDenied = await page.evaluate(async () => {
    const obs = window.__remainingVoicePermission, req = window.__nekocRequire;
    const outcome = await Promise.race([obs.promise, new Promise(resolve => setTimeout(() => resolve({ pendingAfterMs: 3000 }), 3000))]);
    navigator.mediaDevices.getUserMedia = obs.originalGum;
    req(31152).x.get_instance().addError = obs.originalError;
    return { ...outcome, browserPolicy: "microphone denied via CDP Browser.setPermission", gum: obs.gum, domainErrors: obs.errors.length, permission: req(91789).Bj.get_instance().getPermission(), volume: req(91789).Bj.get_instance().core.volume, isRunning: req(91789).Bj.get_instance().core.isRunning };
  });
  // Native playback: official registration API + actual block definitions, no hardware core/init.
  const project = structuredClone(baseProject);
  let serial = 0;
  const block = (type, data = {}) => ({ id: `remaining-${++serial}`, type, ...data });
  const num = value => block("math_number", { fields: { NUM: String(value) } });
  const set = (variable, value, next) => block("variables_set", { fields: { variable }, inputs: { value }, ...(next ? { next } : {}) });
  project.variables.variablesDict = {};
  const scripts = [];
  const baselineCallIds = [];
  const variable = id => { project.variables.variablesDict[id] = { id, name: id, value: 0, type: "any", isGlobal: true, currentEntityId: "nekoc-default-actor", visible: false, position: { x: 0, y: 0 } }; };
  for (const panel of report.editor.panels.filter(p => ["reporter", "command", "event"].includes(p.kind) && p.name !== "get_voice_volume")) {
    const name = panel.name, fields = Object.fromEntries(panel.fields.map(f => [f.name, panel.defaults[f.name]]));
    const inputs = Object.fromEntries(panel.inputs.map(key => [key, num(1)]));
    const hw = block(name, { fields, inputs });
    const vars = ["before", "after", "value"].map(suffix => `${name}:${suffix}`);
    for (const id of vars) variable(id);
    if (panel.kind === "event") { hw.next = set(vars[1], num(1)); scripts.push(hw); continue; }
    const after = set(vars[1], num(1));
    baselineCallIds.push(hw.id);
    const call = panel.kind === "reporter" ? set(vars[2], hw, after) : { ...hw, next: after };
    scripts.push(block("on_running_group_activated", { next: set(vars[0], num(1), call) }));
  }
  for (const id of ["nested:before", "nested:value", "nested:after", "sync:after", "voice:value", "voice:after"]) variable(id);
  const nestedA = block("microbit_temperature"), nestedB = block("microbit_light_level");
  const nested = block("math_arithmetic", { fields: { OP: "ADD" }, inputs: { A: nestedA, B: nestedB } });
  scripts.push(block("on_running_group_activated", { next: set("nested:before", num(1), set("nested:value", nested, set("nested:after", num(1)))) }));
  scripts.push(block("on_running_group_activated", { next: block("microbit_set_bpm", { inputs: { bpm: num(120) }, next: set("sync:after", num(1)) }) }));
  scripts.push(block("on_running_group_activated", { next: set("voice:value", block("get_voice_volume"), set("voice:after", num(1))) }));
  project.actors.actorsDict["nekoc-default-actor"].nekoBlockJsonList = scripts;
  await fs.writeFile(`${out}/scheduler.bcmkn`, JSON.stringify(project, null, 2) + "\n");
  report.nativeFixture = { path: `${out}/scheduler.bcmkn`, sha256: hash(JSON.stringify(project, null, 2) + "\n") };
  report.nativeFixture.baselineCallIds = baselineCallIds;
  report.nativeFixture.nestedCallIds = [nestedA.id, nestedB.id];
  report.nativeSetup = await page.evaluate(project => {
    const req = window.__nekocRequire, runtime = req(26921).cG.get_instance();
    for (const [id, fn, ev] of [[20592, "d", 47252], [62392, "i", 60548], [53026, "S", 81794], [47872, "N", null], [84622, "m", null]]) {
      req(46501).P(req(id)[fn], ev ? req(ev)[ev === 47252 ? "P" : ev === 60548 ? "v" : "r"] : undefined);
    }
    const blink = req(40742).BlinkInstance;
    for (const id of [83939, 89203, 36042, 87745, 38892, 9970]) {
      const Extension = req(id).default, ext = new Extension({ event: req(44454).l });
      if (ext.blink) blink.addToolboxBlocks({ id: ext.id, name: ext.name, text: ext.name, ...ext.blink });
      // Deliberately never call init: map remains genuinely empty.
    }
    req(91107).BcmInstance.setBcm(project);
    blink.workspaceManager.loadWorkspacesFromBcm();
    blink.workspaceManager.selectWorkspace("nekoc-default-actor", true);
    const workspace = blink.core.mainWorkspace, issues = [];
    let expectedBlocks = 0;
    const check = expected => {
      expectedBlocks++;
      const actual = workspace.get_block_by_id(expected.id);
      if (!actual || actual.type !== expected.type) issues.push({ id: expected.id, kind: "missing-or-changed-type" });
      for (const [field, value] of Object.entries(expected.fields || {})) if (actual?.get_field_value(field) !== undefined && String(actual.get_field_value(field)) !== String(value)) issues.push({ id: expected.id, kind: "changed-field", field });
      for (const [input, child] of Object.entries(expected.inputs || {})) { if (actual?.get_input_target_block(input)?.id !== child.id) issues.push({ id: expected.id, kind: "changed-input", input }); check(child); }
      if (expected.next) { if (actual?.get_next_block()?.id !== expected.next.id) issues.push({ id: expected.id, kind: "changed-next" }); check(expected.next); }
    };
    project.actors.actorsDict["nekoc-default-actor"].nekoBlockJsonList.forEach(check);
    const validProject = req(91107).BcmHelpers.validateBcm(project);
    req(69138).default.runtimeStore.recordEnable = false;
    const core = runtime.getHeart().core, manager = core.get_runtime_manager(), registry = core.get_registry();
    window.__remainingNative = { calls: [], variables: [], phases: [], actions: [] };
    const obs = window.__remainingNative;
    let insideUpdate = false;
    const oldUpdate = manager.update;
    manager.update = function(...args) { insideUpdate = true; obs.phases.push({ phase: "update-enter", frame: manager.get_elapsed_frames() }); const result = oldUpdate.apply(this, args); obs.phases.push({ phase: "update-exit", frame: manager.get_elapsed_frames() }); insideUpdate = false; return result; };
    const oldAction = manager.send_action;
    manager.send_action = function(action, ...rest) { if (project.actors.actorsDict["nekoc-default-actor"].nekoBlockJsonList.some(b => b.type === action.id)) obs.actions.push({ id: action.id }); return oldAction.call(this, action, ...rest); };
    for (const name of [...window.__remainingPanels.map(p => p.name), "microbit_set_bpm", "variables_set"]) {
      const index = registry.get_domain_function_index(name), original = registry.domain_function_list[index];
      if (!original) continue;
      registry.domain_function_list[index] = function(args, ...rest) {
        const frame = manager.get_elapsed_frames();
        if (name === "variables_set") obs.variables.push({ variable: args.variable, value: typeof args.value === "number" && Number.isNaN(args.value) ? "NaN" : args.value, frame });
        const value = original.call(this, args, ...rest);
        if (name !== "variables_set") {
          const entry = { name, blockId: rest[3], frame, promise: value instanceof Promise }; obs.calls.push(entry);
          if (value?.then) value.then(v => { entry.settledFrame = manager.get_elapsed_frames(); entry.settledInsideUpdate = insideUpdate; entry.valueType = typeof v; entry.value = typeof v === "number" && Number.isNaN(v) ? "NaN" : v; }, e => entry.error = String(e));
        }
        return value;
      };
    }
    return { hardwareIds: [...req(87282).hardwareMap.keys()], recordEnable: req(69138).default.runtimeStore.recordEnable, registered: window.__remainingPanels.map(p => ({ name: p.name, index: registry.get_domain_function_index(p.name) ?? null })), editorCompat: { ok: validProject && issues.length === 0, validProject, expectedBlocks, actualBlocks: workspace.get_all_blocks().length, issues } };
  }, project);
  await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
  const done = page.getByText(/^完成$/).last();
  if (await done.isVisible()) await done.dispatchEvent("click");
  await page.waitForTimeout(300);
  await page.getByText(/^开始$/).last().dispatchEvent("click");
  await page.waitForTimeout(1600);
  report.native = await page.evaluate(() => {
    const req = window.__nekocRequire, core = req(26921).cG.get_instance().getHeart().core, manager = core.get_runtime_manager();
    return { ...window.__remainingNative, hardwareIds: [...req(87282).hardwareMap.keys()], running: core.get_runtime_data().is_running(), variablesFinal: Object.fromEntries(Object.keys(req(91107).BcmInstance.getBcm().variables.variablesDict).map(id => { const v = manager.get_variable(id); return [id, typeof v === "number" && Number.isNaN(v) ? "NaN" : v]; })), text: document.body.innerText.slice(-1200) };
  });
} catch (e) { report.failure = e.stack; }
finally { await browser.close(); }
report.sourceLocations = [];
for (const { symbol, moduleId, body } of report.editor?.bodies || []) {
  for (const bundle of report.bundles) {
    const text = await fs.readFile(`${out}/${bundle.name}`, "utf8"), excerpt = moduleId ? `${moduleId}:${body}` : body;
    const index = text.indexOf(excerpt);
    if (index < 0) continue;
    report.sourceLocations.push({ symbol, moduleId, bundle: bundle.name, bundleSha256: bundle.sha256, byteOffset: Buffer.byteLength(text.slice(0, index)), excerptCharacters: excerpt.length, excerptSha256: hash(excerpt) });
    break;
  }
}
// Hash compact source locations, never copy official scheduler code into tracked files.
for (const [bundlePrefix, symbol, marker] of [
  ["crc_libs.", "scheduler:domain-call", "t.prototype.step_call_domain_function=function"],
  ["crc_libs.", "scheduler:after-blocker", "t.prototype.step_after_potential_blocker=function"],
  ["crc_libs.", "scheduler:update", "t.prototype.update=function(){var t=this;this.event_bus.runtime_manager.before_update"],
  ["crc_libs.", "scheduler:step-code", "t.prototype.step_code=function"],
  ["crc_libs.", "scheduler:add-task", "t.prototype.add_task=function(t){return t.blocking"],
  ["crc_libs.", "scheduler:task-dispose", "t.prototype.update_dispose=function(){for(var t=0;t<this.tasks_needing_dispose"],
  ["crc_libs.", "compiler:domain", "t.prototype.compile_domain_functions=function"],
  ["main.", "get_voice_volume:domain", "(0,i.Z)(t,u.fM.getVoiceVolume,"],
  ["main.", "get_voice_volume:normalizer", "function H(e){if(!(0,M.qh)(e))return 0;"],
]) {
  const bundle = report.bundles.find(b => b.name.startsWith(bundlePrefix));
  if (!bundle) continue;
  const text = await fs.readFile(`${out}/${bundle.name}`, "utf8"), index = text.indexOf(marker);
  if (index < 0) continue;
  const end = text.indexOf("t.prototype.", index + marker.length);
  const excerpt = text.slice(index, symbol === "get_voice_volume:normalizer" ? text.indexOf("}},73787:", index) + 1 : bundlePrefix === "main." ? index + 1267 : end > index ? end : index + 2000);
  report.sourceLocations.push({ symbol, bundle: bundle.name, bundleSha256: bundle.sha256, byteOffset: Buffer.byteLength(text.slice(0, index)), excerptCharacters: excerpt.length, excerptSha256: hash(excerpt) });
}
report.checks = {
  officialVersion: report.editor?.version === "0.27.4",
  all45Classified: report.editor?.panels.length === 45,
  noHardware: report.editor?.hardwareIds.length === 0,
  thirtySevenPromiseDomains: report.editor?.panels.filter(p => p.kind === "command" || p.kind === "reporter" && p.name !== "get_voice_volume").length === 37 && report.editor?.cases.filter(c => c.label === "defaults").length === 37 && report.editor.cases.filter(c => c.label === "defaults").every(c => c.promise && !c.error),
  noHardwareDomainActionsOrErrors: report.editor?.cases.filter(c => c.sideEffects).every(c => c.sideEffects.actions === 0 && c.sideEffects.domainErrors === 0 && c.sideEffects.hardwareIds.length === 0),
  sixEventSpecs: report.editor?.events.length === 6,
  apiNotRegistered: report.editor?.panels.find(p => p.name === "get_sprite_property")?.definitionRegistered === false,
  allSourcesAnchored: report.editor?.bodies.every(b => report.sourceLocations.some(s => s.symbol === b.symbol)),
  noPageErrors: report.pageErrors.length === 0,
  nativeEditorCompat: report.nativeSetup?.editorCompat.ok === true,
  nativeAll37Awaited: report.native?.calls.filter(c => report.nativeFixture.baselineCallIds.includes(c.blockId)).length === 37 && report.native.calls.filter(c => report.nativeFixture.baselineCallIds.includes(c.blockId)).every(c => c.promise && c.settledFrame > c.frame && c.settledInsideUpdate === false && report.native.variables.some(v => v.variable === c.name + ":after" && v.frame > c.frame)),
  nestedReporterSequentialAwait: report.native?.calls.find(c => c.blockId === report.nativeFixture.nestedCallIds[1])?.frame > report.native?.calls.find(c => c.blockId === report.nativeFixture.nestedCallIds[0])?.frame && report.native?.variables.find(v => v.variable === "nested:after")?.frame > report.native?.calls.find(c => c.blockId === report.nativeFixture.nestedCallIds[1])?.frame,
  syncCommandNoAwait: report.native?.variables.find(v => v.variable === "sync:after")?.frame === 0,
  nativeDisabledVoiceAwaited: report.nativeSetup?.recordEnable === false && report.native?.variablesFinal["voice:value"] === "NaN" && report.native?.variables.find(v => v.variable === "voice:after")?.frame > report.native?.calls.find(c => c.name === "get_voice_volume")?.frame,
  realBrowserDeniedVoiceZero: report.voicePermission?.browserDenied?.result?.value === 0 && report.voicePermission.browserDenied.gum.some(c => c.errorName === "NotAllowedError") && report.voicePermission.browserDenied.permission === false && report.voicePermission.browserDenied.domainErrors === 1,
  nativeEventsSilent: report.native?.actions.length === 0 && report.editor?.panels.filter(p => p.kind === "event").every(p => report.native.variablesFinal[p.name + ":after"] === 0),
};
report.ok = !report.failure && Object.values(report.checks).every(Boolean);
await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
if (process.argv.includes("--record") && report.ok) {
  const { bodies, conversions, ...editor } = report.editor;
  const blocks = editor.panels.map(panel => {
    const cases = editor.cases.filter(c => c.name === panel.name), baseline = cases.find(c => c.label === "defaults");
    const nativeCall = report.native.calls.find(c => c.name === panel.name && report.nativeFixture.baselineCallIds.includes(c.blockId));
    return { ...panel, directPromise: baseline?.promise, directResult: baseline?.result, argumentReads: cases.find(c => c.label === "argument access")?.reads, rejectionLabels: cases.filter(c => c.error).map(c => c.label), nativeCall, nativeAfterFrame: report.native.variables.find(v => v.variable === panel.name + ":after")?.frame, eventBodyExecuted: panel.kind === "event" ? report.native.variablesFinal[panel.name + ":after"] !== 0 : undefined };
  });
  const { permissionDialog, ...summary } = report;
  await fs.writeFile("docs/kn-remaining-official-evidence.json", JSON.stringify({ ...summary, permissionDialog: { text: permissionDialog.text, keys: permissionDialog.keys }, blocks, editor: { ...editor, conversions: conversions.map(({ xml, ...c }) => c) }, limitations: ["Empty hardware map, never call hardware init/connect; connected and installed-but-disconnected cores unmeasured.", "Extension domain/block registration uses the real official registration APIs, but hardware init is intentionally omitted. This is not a default installed editor profile.", "Native observations cover the generated default/number-one fixture, one sibling-reporter sum and one synchronous control; not all nesting/warp/stop/restart schedules.", "Finite native event silence does not prove global unreachability; manual send_action and synthetic notifications remain outside the profile.", "Default microphone is pending at 3000ms before consent; later real modal denial and browser NotAllowedError are distinguished. Actual NotFoundError/no-device, successful capture and other platforms unmeasured. recordEnable=false is selected explicitly.", "Generic tools/editor-compat.mjs does not load these lazy hardware extensions; nativeSetup.editorCompat runs extension-aware validateBcm and all-block field/connection checks before playing.", "Downloaded official implementation and full module bodies exist only under ignored dist; evidence JSON retains only observations, metadata and source hashes."] }, null, 2) + "\n");
}
console.log(JSON.stringify({ ok: report.ok, failure: report.failure, checks: report.checks, cases: report.editor?.cases.length }, null, 2));
if (!report.ok) process.exitCode = 1;
