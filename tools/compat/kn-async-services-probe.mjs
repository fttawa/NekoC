#!/usr/bin/env node
// Original KN service/timer oracle. Downloaded official code stays under dist.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const out = "dist/kn-async-services";
const fixture = "tests/fixtures/kn-async-services/timers.bcmkn";
const hardwareNames = ["microbit_button_is_pressed", "microbit_light_level", "microbit_temperature", "microbit_get_volume", "microbit_led_clear", "catbit_button_is_pressed", "wand_button_is_pressed", "wand_coordinate", "wand_rotation", "wand_reset_position", "get_robot_master_motor_power", "get_robot_master_infrared_sensor_distance", "stop_robot_master_motor", "get_robot2_master_motor_power", "stop_robot2_master_motor"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const names = ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "get_orientation", "get_voice_volume", "get_voice_answer", "username_get", "user_id_get", "ai_chat_answer", "ai_chat_ask", "new_conversation", "ai_text_result", "ai_text_result_check", "translate_result", "get_face_detection_result", "get_object_detection_result", "get_evaluate_class_name", "get_evaluate_class_accuracy", "check_gender", "check_emotion", "check_face_shape", "check_tilt_direction_of_face", "get_tilt_angle_of_face", "get_position_of_body_part", "get_appearance_of_part", "recognize_gesture", "recognize_body_part", "face_to_body_part", "bump_into_body_part", "move_to_body_part", "voice_recognition", "translate", "ai_text_photo", "ai_text_actor", "enable_face_detect_by_actor", "enable_face_detect_by_photo", "enable_object_detect_by_actor", "enable_object_detect_by_photo", "evaluate_camera", "evaluate_photo", "evaluate_actor_style", "user_info_of_th", "user_ranking_info", "update_ranking", "show_hide_ranking"];
await fs.mkdir(out, { recursive: true });
const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES, "package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = { checkedAt: new Date().toISOString(), url: "https://kn.codemao.cn/editor", bundles: [], pageErrors: [], limitations: ["Fresh headless Edge context; no login, device permissions or hardware supplied.", "Direct domain calls are distinguished from full project execution."] };
try {
  const page = await browser.newPage();
  page.on("pageerror", e => report.pageErrors.push(e.message));
  await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body();
    const url = route.request().url(), name = path.basename(new URL(url).pathname);
    await fs.writeFile(path.join(out, name), bytes);
    report.bundles.push({ name, url, bytes: bytes.length, sha256: sha256(bytes) });
    let source = bytes.toString("utf8");
    if (name.startsWith("main.")) source = source.replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=")
      .replace("return n}var m=n(8586)", "return n}window.__knServicesFactory=A;var m=n(8586)");
    await route.fulfill({ response, body: source });
  });
  const fixtureSource = await fs.readFile(fixture, "utf8");
  const project = JSON.parse(fixtureSource);
  report.fixture = { path: fixture, sha256: sha256(fixtureSource) };
  const projectUrl = "https://kn.codemao.cn/__nekoc_kn_services__.bcmkn";
  await page.route(projectUrl, route => route.fulfill({ contentType: "application/json", body: JSON.stringify(project) }));
  await page.goto(report.url + "?previewUrl=" + encodeURIComponent(projectUrl), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") && window.__nekocRequire(91107).BcmInstance.getBcm().projectName === "NekoC KN timers oracle" && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  report.editor = await page.evaluate(async names => {
    const req = window.__nekocRequire;
    const find = name => {
      for (const [id, factory] of Object.entries(req.m)) {
        if (!String(factory).includes(name + ":function")) continue;
        const exp = req(id);
        if (exp[name]) return exp[name];
      }
      throw new Error("Missing official export " + name);
    };
    const workspace = find("BlinkInstance").core.mainWorkspace;
    const workspaceImport = ["kn-services-4", "kn-services-8"].map(id => {
      const block = workspace.get_block_by_id(id), callback = block?.get_input_target_block("callback");
      return { id, type: block?.type, callbackId: callback?.id, callbackType: callback?.type, callbackInputType: block?.get_input("callback")?.type, callbackVariable: callback?.get_field_value("variable") };
    });
    const core = req(26921).cG.get_instance().getHeart().core;
    const registry = core.get_registry();
    const availability = {};
    for (const name of names) {
      let block;
      try {
        block = workspace.new_block(name);
        availability[name] = { registered: true, output: !!block.output_connection, previous: !!block.previous_connection, next: !!block.next_connection, inputs: block.inputList.map(i => ({ name: i.name, type: i.type, fields: i.fieldRow.map(f => ({ name: f.name, value: f.get_value?.() })) })), domainIndex: registry.get_domain_function_index(name) ?? null };
      } catch (e) { availability[name] = { error: e.message }; }
      finally { block?.dispose(); }
    }
    const modules = [];
    for (const [id, factory] of Object.entries(req.m)) {
      const source = String(factory), matches = names.filter(name => source.includes(name + ":function"));
      const camelNames = ["usernameGet", "userIdGet", "getVoiceVolume", "getVoiceAnswer", "aiChatAnswer", "getFaceDetectionResult", "recognizeBodyPart", "getEvaluateClassName", "userRankingInfo"];
      if (matches.length || camelNames.some(name => source.includes("." + name + "]") || source.includes("." + name + ":"))) modules.push({ id, matches, source });
    }
    const runtimeFunctions = {};
    for (const name of names) {
      const index = registry.get_domain_function_index(name);
      const entry = registry.domain_function_list[index];
      runtimeFunctions[name] = { index, entryType: typeof entry, keys: entry && Object.keys(entry), source: String(entry) };
    }
    const call = (name, args = {}) => registry.domain_function_list[registry.get_domain_function_index(name)](args, "probe", "nekoc-default-actor", "nekoc-default-actor", "probe", {});
    const encode = value => ({ type: typeof value, value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value });
    const serviceCalls = [];
    for (const name of ["get_orientation", "get_voice_volume", "get_voice_answer", "username_get", "user_id_get", "ai_chat_answer", "ai_text_result", "ai_text_result_check", "get_face_detection_result", "get_object_detection_result", "get_evaluate_class_name", "get_evaluate_class_accuracy", "check_gender", "check_emotion", "check_face_shape", "check_tilt_direction_of_face", "get_tilt_angle_of_face", "get_position_of_body_part", "get_appearance_of_part", "recognize_gesture", "recognize_body_part", "bump_into_body_part", "move_to_body_part", "face_to_body_part", "user_info_of_th", "user_ranking_info"]) {
      const args = Object.fromEntries((availability[name].inputs || []).flatMap(i => i.fields).filter(f => f.name).map(f => [f.name, f.value]));
      if (name === "ai_text_result_check") args.text = "";
      if (name === "user_info_of_th") args.order = 1;
      try {
        const value = call(name, args);
        if (value?.then) serviceCalls.push({ name, args, promise: true, result: await Promise.race([value.then(encode).catch(e => ({ error: String(e), stack: e?.stack })), new Promise(resolve => window.setTimeout(() => resolve({ pending: true }), 3000))]) });
        else serviceCalls.push({ name, args, result: encode(value) });
      } catch (e) { serviceCalls.push({ name, args, error: String(e), stack: e?.stack }); }
    }
    const timerCalls = { timeoutCount: 0, intervalCount: 0, canceledCount: 0 };
    const t = call("setTimeout", { callback: () => timerCalls.timeoutCount++, delay: 20 });
    const i = call("setInterval", { callback: () => timerCalls.intervalCount++, delay: 15 });
    const canceled = call("setTimeout", { callback: () => timerCalls.canceledCount++, delay: 20 });
    timerCalls.ids = [t, i, canceled].map(encode);
    timerCalls.clearReturn = encode(call("clearTimeout", { timeoutId: canceled }));
    await new Promise(resolve => window.setTimeout(resolve, 100));
    timerCalls.clearIntervalReturn = encode(call("clearInterval", { intervalId: i }));
    timerCalls.afterClear = timerCalls.intervalCount;
    await new Promise(resolve => window.setTimeout(resolve, 60));
    const notFunction = call("setTimeout", { callback: "window.__knTimerTextExecuted = true", delay: 1 });
    await new Promise(resolve => window.setTimeout(resolve, 20));
    timerCalls.textCallback = { id: encode(notFunction), executed: window.__knTimerTextExecuted === true };
    const conversions = [];
    for (const code of ["setTimeout(() => { get_timer(); }, 100);", "setInterval(() => { get_timer(); }, 100);", "setTimeout(handler, 100);", "setTimeout('text', 100);", "const id = setTimeout(() => { get_timer(); }, 100);", "clearTimeout(7);", "clearInterval(7);"]) {
      try { const xml = req(58890)._j(code); conversions.push({ code, xml, js: xml.xml ? req(58890).Eb(xml.xml) : null }); }
      catch (e) { conversions.push({ code, error: e.stack }); }
    }
    const types = req(96733).ZH();
    return { version: req(91107).BcmInstance.getBcm().version, workspaceImport, availability, modules, conversions, timerTypes: Object.fromEntries(["setTimeout", "setInterval", "clearTimeout", "clearInterval"].map(n => [n, types[n]])), runtimeFunctions, serviceCalls, timerCalls, coreKeys: Object.keys(core), registryKeys: Object.keys(registry), extraFactory: typeof window.__knServicesFactory };
  }, names);
  report.hardware = await page.evaluate(async names => {
    const req = window.__nekocRequire, core = req(26921).cG.get_instance().getHeart().core, registry = core.get_registry();
    const calls = [];
    for (const name of names) {
      const index = registry.get_domain_function_index(name);
      if (index === undefined) { calls.push({ name, registeredDomain: false }); continue; }
      const args = { key: name.includes("microbit") ? "A" : name.includes("catbit") ? "0" : "x", motor: "0" };
      try {
        const result = registry.domain_function_list[index](args, "probe", "nekoc-default-actor", "nekoc-default-actor", "probe", {});
        const encode = v => ({ type: typeof v, value: typeof v === "number" && !Number.isFinite(v) ? String(v) : v });
        calls.push({ name, registeredDomain: true, args, promise: !!result?.then, result: result?.then ? await Promise.race([result.then(encode).catch(e => ({ error: String(e), details: JSON.parse(JSON.stringify(e)) })), new Promise(resolve => window.setTimeout(() => resolve({ pending: true }), 1000))]) : encode(result) });
      } catch (e) { calls.push({ name, registeredDomain: true, args, error: String(e), details: JSON.parse(JSON.stringify(e)) }); }
    }
    const modules = Object.entries(req.m).filter(([, f]) => /device_not_connected|not_connected|microbitButtonIsPressed.*function|common:function|is_microbit_button_pressed.*function/.test(String(f))).map(([id, f]) => ({ id, source: String(f) }));
    const matchingRegistry = Object.entries(registry.domain_function_index).filter(([k]) => /microbit|catbit|wand|robot|tudao/.test(k));
    const hardwareCoreChecks = ["microbit", "catbit", "wand", "tudao", "tudao2"].map(id => {
      try { return { id, type: typeof window.getHardwareCoreAndCheck(id) }; }
      catch (e) { return { id, error: String(e) }; }
    });
    return { calls, modules, matchingRegistry, hardwareCoreChecks };
  }, hardwareNames);
  await page.addStyleTag({ content: "#DialogContainer{display:none!important}" });
  const done = page.getByText(/^完成$/).last();
  if (await done.isVisible()) await done.dispatchEvent("click");
  await page.evaluate(() => {
    window.__knNativeTimerCalls = [];
    window.__knDomainTimerCalls = [];
    const registry = window.__nekocRequire(26921).cG.get_instance().getHeart().core.get_registry();
    for (const name of ["setTimeout", "setInterval"]) {
      const index = registry.get_domain_function_index(name), fn = registry.domain_function_list[index];
      registry.domain_function_list[index] = function(args, ...rest) {
        window.__knDomainTimerCalls.push({ name, keys: Object.keys(args), callbackType: typeof args.callback, callback: String(args.callback), delay: args.delay });
        return fn(args, ...rest);
      };
    }
    const original = window.setTimeout;
    window.setTimeout = function(callback, delay, ...args) {
      if (Number(delay) === 137) window.__knNativeTimerCalls.push({ callbackType: typeof callback, callbackSource: String(callback), delay });
      return original.call(window, callback, delay, ...args);
    };
  });
  await page.getByText(/^开始$/).last().dispatchEvent("click");
  await page.waitForTimeout(1000);
  report.projectTimer = await page.evaluate(() => {
    const core = window.__nekocRequire(26921).cG.get_instance().getHeart().core;
    const manager = core.get_runtime_manager();
    return { running: core.get_runtime_data().is_running(), variables: Object.fromEntries(["ready", "fired", "after"].map(id => [id, manager.get_variable(id)])), nativeCalls: window.__knNativeTimerCalls, domainCalls: window.__knDomainTimerCalls, text: document.body.innerText.slice(-1800) };
  });
} catch (e) { report.failure = e.stack; process.exitCode = 1; }
finally {
  await browser.close();
  const anchors = {
    "main.8ccf2442.js": ["setTimeout:function(e)", "setInterval:function(e)", "clearTimeout:function(e)", "clearInterval:function(e)", "(0,i.Z)(t,u.fM.getOrientation,function()", "(0,i.Z)(t,u.fM.getVoiceVolume,function()", "(0,c.Z)(t,u.vk.usernameGet,", "(0,c.Z)(t,u.vk.userIdGet,", "(0,c.Z)(t,u.V1.recognizeBodyPart,", "(0,c.Z)(t,u.V1.bumpIntoBodyPart,", "(0,c.Z)(t,u.V1.moveToBodyPart,", "(0,c.Z)(t,u.V1.faceToBodyPart,", "(0,c.Z)(t,u.V1.getPositionOfBodyPart,", "(0,c.Z)(t,u.V1.getAppearanceOfPart,", "(0,c.Z)(t,u.V1.getTiltAngleOfFace,", "(0,c.Z)(t,u.V1.checkTiltDirectionOfFace,", "(0,c.Z)(t,u.V1.recognizeGesture,", "getVoiceAnswer,function", "ai_text_result:function()"],
    "crc_libs.8196dbd1.js": ["t.prototype.compile_domain_functions=function", "t.prototype.compile_params=function"],
  };
  anchors["main.8ccf2442.js"].push("function _(e){var t=o.cG.get_instance().runtimeId;", 'function M(e){var t=d.get(e);if(!t)throw new Error("No hardware of id "', 'catbit_button_when:"on_catbit_button"');
  report.locations = [];
  for (const [name, terms] of Object.entries(anchors)) {
    const bytes = await fs.readFile(path.join(out, name)), source = bytes.toString("utf8");
    for (const anchor of terms) {
      const index = source.indexOf(anchor);
      report.locations.push({ bundle: name, sha256: sha256(bytes), anchor, byteOffset: index < 0 ? null : Buffer.byteLength(source.slice(0, index)), excerptSha256: index < 0 ? null : sha256(source.slice(index, index + 500)) });
    }
  }
  const timer = report.editor?.timerCalls, projectTimer = report.projectTimer;
  report.checks = {
    realFunctionCallbacks: timer?.timeoutCount === 1 && timer?.intervalCount > 1 && timer?.intervalCount === timer?.afterClear && timer?.canceledCount === 0,
    textNotEvaluated: timer?.textCallback?.executed === false,
    nativeCallbackStatementsDropped: projectTimer?.domainCalls?.length === 2 && projectTimer.domainCalls.every(c => c.callbackType === "undefined" && c.keys.length === 1 && c.keys[0] === "delay") && projectTimer.variables.ready === 1 && projectTimer.variables.after === 1 && projectTimer.variables.fired === 0,
    sourceAnchorsFound: report.locations.every(l => l.byteOffset !== null),
    workspacePreservesCallbackStatements: report.editor?.workspaceImport?.length === 2 && report.editor.workspaceImport.every(b => b.callbackType === "variables_set" && b.callbackVariable === "fired" && b.callbackInputType === 3),
    noUncaughtPageErrors: report.pageErrors.length === 0,
  };
  report.ok = !report.failure && Object.values(report.checks).every(Boolean);
  if (!report.ok) process.exitCode = 1;
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  if (process.argv.includes("--record") && report.ok) {
    const compat = JSON.parse(await fs.readFile(path.join(out, "editor-compat.json"), "utf8"));
    const validated = compat.projects.find(p => p.sha256 === report.fixture.sha256);
    if (!compat.ok || !validated?.ok) throw new Error("Run editor-compat for the exact fixture hash before --record");
    const { text: _pageText, nativeCalls, ...projectTimer } = report.projectTimer;
    const symbols = ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "get_orientation", "get_voice_volume", "username_get", "user_id_get", "recognize_body_part", "bump_into_body_part", "move_to_body_part", "face_to_body_part", "get_position_of_body_part", "get_appearance_of_part", "get_tilt_angle_of_face", "check_tilt_direction_of_face", "recognize_gesture", "get_voice_answer", "ai_text_result", "getHardwareCoreAndCheck", "getHardware", "hardwareBlockToCodeAliases", "compile_domain_functions", "compile_params"];
    const evidence = {
      schema: "nekoc-kn-async-services-official-v1", checkedAt: report.checkedAt,
      editorUrl: report.url, editorVersion: report.editor.version,
      method: "Fresh headless Edge official editor; webpack loader exposed; direct registry calls; saved original fixture through previewUrl; passive registry/browser timer argument wrappers forward to original functions. No service function bodies modified.",
      fixture: report.fixture,
      bundles: report.bundles.filter(b => ["main.", "main-vendors.", "crc_libs."].some(p => b.name.startsWith(p))),
      sourceLocations: report.locations.map((l, i) => ({ symbol: symbols[i], bundle: l.bundle, bundleSha256: l.sha256, byteOffset: l.byteOffset, excerptCharacters: 500, excerptSha256: l.excerptSha256 })),
      editorCompat: { editorUrl: compat.editorUrl, checkedAt: compat.checkedAt, bundleUrl: compat.bundleUrl, ok: compat.ok, project: { ...validated, input: fixture } },
      availability: Object.fromEntries(Object.entries(report.editor.availability).map(([name, b]) => [name, { registered: b.registered, output: b.output, previous: b.previous, next: b.next, domainIndex: b.domainIndex, sockets: b.inputs?.filter(i => i.name).map(i => ({ name: i.name, type: i.type })) }])),
      timerTypes: report.editor.timerTypes,
      workspaceImport: report.editor.workspaceImport,
      conversionObservations: report.editor.conversions.map(c => ({ input: c.code, errors: c.xml?.errors, warnings: c.js?.warnings, callbackStatement: c.xml?.xml?.includes('<statement name="callback">') ?? false, callbackArgumentRetained: c.xml?.xml?.includes('<statement name="callback">') ?? false, nestedAssignment: c.xml?.xml?.includes('type="_variable_set"') ?? false })),
      serviceCalls: report.editor.serviceCalls.map(({ stack: _stack, ...c }) => c),
      hardwareCalls: report.hardware.calls,
      hardwareCoreChecks: report.hardware.hardwareCoreChecks,
      hardwareRegistry: report.hardware.matchingRegistry,
      directTimerCalls: report.editor.timerCalls,
      projectTimer: { ...projectTimer, nativeCalls: nativeCalls.map(({ callbackSource, ...c }) => ({ ...c, isEmptyFunction: /^function\s*\(\)\s*\{\}$/.test(callbackSource) })) },
      checks: report.checks, pageErrors: report.pageErrors, ok: report.ok,
      limitations: [...report.limitations, "Native callback statement bodies were preserved by workspace importer but missing from runtime args; this is not general callback support.", "Direct service calls observe fresh empty caches; AI/network commands remain unsupported.", "No timer stop/restart, hardware permissions, login, clone/closure or browser background tests."],
    };
    if (process.argv.includes("--trace")) {
      const binary = process.platform === "win32" ? "target/debug/kn-trace.exe" : "target/debug/kn-trace";
      const trace = spawnSync(binary, [fixture], { encoding: "utf8" });
      if (trace.error || trace.status !== 0) throw new Error("kn-trace failed: " + (trace.error || trace.stderr));
      const observation = JSON.parse(trace.stdout);
      evidence.localComparison = {
        checkedAt: new Date().toISOString(), command: `${binary} ${fixture}`, fixtureSha256: report.fixture.sha256,
        binarySha256: sha256(await fs.readFile(binary)), traceSourceSha256: sha256(await fs.readFile("src/bin/kn-trace.rs")),
        virtualFrames: 180, observation, officialVariables: report.projectTimer.variables,
        equalVariables: JSON.stringify(Object.entries(observation.variables).sort()) === JSON.stringify(Object.entries(report.projectTimer.variables).sort()),
        limitation: "Default kn-trace engine path, 180 virtual frames; only final fixture variables compared. Not generic callback, stop/restart or full scheduler parity.",
      };
      if (!evidence.localComparison.equalVariables) throw new Error("Local timer fixture differs from official final variables");
    }
    await fs.writeFile("docs/kn-async-services-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  }
}
console.log(JSON.stringify({ version: report.editor?.version, modules: report.editor?.modules.map(m => ({ id: m.id, matches: m.matches })), failure: report.failure }, null, 2));
