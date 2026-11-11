#!/usr/bin/env node
// Authored official-editor probe. Third-party bytes/function bodies stay in dist.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const out = "dist/kn-offline-round3";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES || `${out}/deps/node_modules`, "package.json"));
const { chromium } = require("playwright");
const names = ["ai_chat_answer", "ai_text_result", "ai_text_result_check", "translate_result", "get_face_detection_result", "get_object_detection_result", "check_gender", "check_emotion", "check_face_shape", "get_evaluate_class_name", "get_evaluate_class_accuracy", "user_info_of_th", "user_ranking_info", "open_hide_camera", "open_close_webcam", "set_camera_alpha", "set_webcam_alpha", "get_voice_volume", "microbit_temperature", "microbit_button_is_pressed", "catbit_button_is_pressed", "wand_coordinate", "get_robot_master_motor_power"];
await fs.mkdir(out, { recursive: true });
const report = { schema: "nekoc-kn-offline-round3-v1", checkedAt: new Date().toISOString(), editorUrl: "https://kn.codemao.cn/editor", method: "Fresh headless Edge official editor, webpack loader exposed; official registry calls with args objects; passive runtime cache-read wrapper forwards to original getter; seeded authored values written through official runtime setter and cleared after reading. No service implementation replaced.", bundles: [], pageErrors: [], limitations: ["Isolated fresh desktop Edge; no login, camera, microphone or hardware supplied.", "Direct registry calls, not a complete native project. No AI request or model loading invoked.", "Seeded cache observations validate function arguments only; they are not backend support."] };
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", e => report.pageErrors.push(e.message));
  await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body();
    const url = route.request().url(), name = path.basename(new URL(url).pathname);
    await fs.writeFile(path.join(out, name), bytes);
    report.bundles.push({ name, url, bytes: bytes.length, sha256: sha256(bytes) });
    const source = name.startsWith("main.") ? bytes.toString("utf8").replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") : bytes;
    await route.fulfill({ response, body: source });
  });
  await page.goto(report.editorUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  report.editor = await page.evaluate(async names => {
    const req = window.__nekocRequire;
    const find = name => {
      for (const [id, factory] of Object.entries(req.m)) {
        if (String(factory).includes(name + ":function")) { const exp = req(id); if (exp[name]) return exp[name]; }
      }
      throw new Error("Missing export " + name);
    };
    const workspace = find("BlinkInstance").core.mainWorkspace;
    const core = req(26921).cG.get_instance().getHeart().core, registry = core.get_registry(), data = core.get_runtime_data();
    const availability = {}, runtimeFunctions = {};
    for (const name of names) {
      let block;
      const index = registry.get_domain_function_index(name);
      runtimeFunctions[name] = String(registry.domain_function_list[index]);
      try {
        block = workspace.new_block(name);
        availability[name] = { registered: true, domainIndex: index ?? null, output: !!block.output_connection, inputs: block.inputList.map(i => ({ name: i.name, type: i.type, fields: i.fieldRow.map(f => ({ name: f.name, value: f.get_value?.() })) })) };
      } catch (e) { availability[name] = { registered: false, domainIndex: index ?? null, error: e.message }; }
      finally { block?.dispose(); }
    }
    const encode = value => ({ type: typeof value, ...(value === undefined ? {} : { value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value }) });
    const calls = [], cacheReads = [];
    const originalGet = data.get_arbitrary_data;
    data.get_arbitrary_data = function(key) { cacheReads.push(key); return originalGet.call(this, key); };
    const call = async (name, args, phase = "initial") => {
      cacheReads.length = 0;
      try {
        const value = registry.domain_function_list[registry.get_domain_function_index(name)](args, "probe", "probe-actor", "probe-actor", "probe", {});
        const result = value?.then ? await Promise.race([value.then(encode).catch(e => ({ error: String(e) })), new Promise(resolve => setTimeout(() => resolve({ pending: true }), 1500))]) : encode(value);
        calls.push({ name, args, phase, promise: !!value?.then, cacheReads: [...cacheReads], result });
      } catch (e) { calls.push({ name, args, phase, error: String(e) }); }
    };
    for (const name of ["ai_chat_answer", "ai_text_result", "get_object_detection_result", "check_gender", "check_emotion", "check_face_shape", "user_info_of_th", "user_ranking_info"]) {
      const args = Object.fromEntries((availability[name].inputs || []).flatMap(i => i.fields).filter(f => f.name).map(f => [f.name, f.value]));
      if (name === "user_info_of_th") args.order = 1;
      await call(name, args);
    }
    for (const type of ["age", "emotion", "gender", "faceShape", "not-a-field"]) await call("get_face_detection_result", { type });
    for (const options of ["include", "exclude"]) for (const text of ["", "cat", 123]) await call("ai_text_result_check", { options, text });
    for (const text of ["", " ", "\t\n"]) await call("translate_result", { text, language: "en" });
    // Full valid field shapes, but no ranking object exists. Not a real leaderboard test.
    await call("user_ranking_info", { ranking: "probe-missing-ranking", type: "rank" });
    await call("user_info_of_th", { ranking: "probe-missing-ranking", type: "username", order: 1 });
    // Seed actual runtime storage, never replace service function results.
    for (const [name, value] of [["ai_chat_answer", "probe chat"], ["ai_text_result", "cat"], ["get_face_detection_result", { age: 12, gender: "male", emotion: "happy", faceShape: "square" }], ["get_object_detection_result", { keyword: "probe object" }]]) {
      const key = calls.find(c => c.name === name).cacheReads[0];
      if (!key) throw new Error("Missing observed cache key for " + name);
      data.set_arbitrary_data(key, value);
      if (name === "ai_text_result") {
        await call(name, {}, "seeded");
        for (const options of ["include", "exclude"]) for (const text of ["cat", "dog", ""]) await call("ai_text_result_check", { options, text }, "seeded");
        for (const [state, cached] of [["empty", ""], ["NaN", NaN]]) {
          data.set_arbitrary_data(key, cached);
          await call(name, {}, "seeded-" + state);
          for (const options of ["include", "exclude"]) await call("ai_text_result_check", { options, text: "" }, "seeded-" + state);
        }
      } else if (name === "get_face_detection_result") {
        for (const type of ["age", "gender", "emotion", "faceShape"]) await call(name, { type }, "seeded");
        for (const [check, field, val] of [["check_gender", "gender", "male"], ["check_emotion", "emotion", "happy"], ["check_face_shape", "face_shape", "square"]]) await call(check, { [field]: val }, "seeded");
      } else await call(name, {}, "seeded");
      data.set_arbitrary_data(key, undefined);
    }
    data.get_arbitrary_data = originalGet;
    const cacheKeys = Object.keys(data).filter(k => /arbitrary/.test(k));
    const modules = Object.entries(req.m).filter(([, f]) => /ai_text_result:function|getAiChatDomainFunctions:function|No hardware of id/.test(String(f))).map(([id, f]) => ({ id, source: String(f) }));
    return { version: req(91107).BcmInstance.getBcm().version, availability, runtimeFunctions, calls, modules, cacheKeys, dataKeys: Object.keys(data), matchingRegistry: Object.entries(registry.domain_function_index).filter(([k]) => /microbit|catbit|wand|robot|tudao/.test(k)) };
  }, names);
} catch (e) { report.failure = e.stack; process.exitCode = 1; }
finally { await browser.close(); }
// Byte positions refer to the ORIGINAL downloaded UTF-8 bundle, not instrumented code.
const anchors = [
  ["ai_chat_answer", "(0,c.Z)(t,u.S9.aiChatAnswer,", 500],
  ["ai_text_result", "ai_text_result:function()", 500],
  ["ai_text_result_check", "ai_text_result_check:function(t,n)", 500],
  ["ocr_argument_adapter", "function Le(e){var t=(0,e.functions)(ue);", 1300],
  ["ocr_auth_scope", '"needAuthBlocks":["ai_text_actor","ai_text_photo"]', 500],
  ["get_face_detection_result", "(0,c.Z)(t,u.FF.getFaceDetectionResult,", 500],
  ["get_object_detection_result", "(0,c.Z)(t,u.FF.getObjectDetectionResult,", 500],
  ["check_gender", "(0,c.Z)(t,u.FF.checkGender,", 500],
  ["check_emotion", "(0,c.Z)(t,u.FF.checkEmotion,", 500],
  ["check_face_shape", "(0,c.Z)(t,u.FF.checkFaceShape,", 500],
  ["translate_result", "(0,r.Z)(t,h.U4.translateResult,", 800],
  ["get_evaluate_class_name", "(0,c.Z)(t,u.Jw.getEvaluateClassName,", 2400],
  ["get_evaluate_class_accuracy", "(0,c.Z)(t,u.Jw.getEvaluateClassAccuracy,", 2400],
  ["user_ranking_info", "(0,c.Z)(t,u.vk.userRankingInfo,", 1600],
  ["user_info_of_th", "(0,c.Z)(t,u.vk.userInfoOfTh,", 1800],
  ["open_hide_camera", "(0,c.Z)(t,u.V1.openCloseCamera,", 2300],
  ["open_close_webcam", "(0,c.Z)(t,u.Jw.openCloseWebcam,", 2300],
  ["set_camera_alpha", "(0,c.Z)(t,u.V1.setCameraAlpha,", 800],
  ["set_webcam_alpha", "(0,c.Z)(t,u.Jw.setWebcamAlpha,", 800],
  ["get_voice_volume", "(0,i.Z)(t,u.fM.getVoiceVolume,", 1600],
  ["hardware_common", "function _(e){var t=o.cG.get_instance().runtimeId;", 1200],
];
const main = report.bundles.find(b => b.name.startsWith("main."));
report.sourceLocations = [];
if (main) {
  const bytes = await fs.readFile(`${out}/${main.name}`), source = bytes.toString("utf8");
  for (const [symbol, anchor, excerptCharacters] of anchors) {
    const index = source.indexOf(anchor);
    report.sourceLocations.push({ symbol, bundle: main.name, bundleUrl: main.url, bundleSha256: main.sha256, byteOffset: index < 0 ? null : Buffer.byteLength(source.slice(0, index)), excerptCharacters, excerptSha256: index < 0 ? null : sha256(source.slice(index, index + excerptCharacters)) });
  }
}
report.checks = {
  sourceAnchorsFound: report.sourceLocations.length === anchors.length && report.sourceLocations.every(l => l.byteOffset !== null),
  noUncaughtPageErrors: report.pageErrors.length === 0,
  initialCachesTyped: report.editor?.calls.filter(c => c.phase === "initial" && !["translate_result", "user_info_of_th", "user_ranking_info"].includes(c.name)).every(c => !c.error && c.result?.type && !c.result.pending) ?? false,
  seededAdapterWorks: report.editor?.calls.some(c => c.name === "ai_text_result_check" && c.phase === "seeded" && c.args.options === "include" && c.args.text === "cat" && c.result.value === true) && report.editor?.calls.some(c => c.name === "ai_text_result_check" && c.phase === "seeded" && c.args.options === "exclude" && c.args.text === "dog" && c.result.value === true),
};
report.ok = !report.failure && Object.values(report.checks).every(Boolean);
await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
if (!report.ok) process.exitCode = 1;
if (process.argv.includes("--record") && report.ok) {
  const { modules, runtimeFunctions, dataKeys, cacheKeys, ...editor } = report.editor;
  const evidence = { ...report, editor };
  await fs.writeFile("docs/kn-offline-round3-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
}
console.log(JSON.stringify({ ok: report.ok, failure: report.failure, version: report.editor?.version, checks: report.checks, sourceLocations: report.sourceLocations.map(l => ({ symbol: l.symbol, byteOffset: l.byteOffset })) }, null, 2));
