#!/usr/bin/env node
// Original evidence collector. Official bytes and function bodies stay in dist.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const out = "dist/kn-panel-ai";
const hash = v => createHash("sha256").update(v).digest("hex");
const require = createRequire(path.resolve(process.env.NEKOC_NODE_MODULES || `${out}/deps/node_modules`, "package.json"));
const { chromium } = require("playwright");
const names = ["ai_chat_ask", "new_conversation", "set_system_preset", "ai_text_actor", "ai_text_photo", "enable_face_detect_by_actor", "enable_face_detect_by_photo", "enable_object_detect_by_actor", "enable_object_detect_by_photo", "evaluate_actor_style", "evaluate_camera", "evaluate_photo", "get_evaluate_class_accuracy", "get_evaluate_class_name"];
await fs.mkdir(out, { recursive: true });
const report = { schema: "nekoc-kn-panel-ai-v1", checkedAt: new Date().toISOString(), editorUrl: "https://kn.codemao.cn/editor", bundles: [], pageErrors: [], method: "Fresh anonymous Edge; expose webpack loader without replacing official domain functions. Read real blocks/registry. After initialization abort every HTTP request and WebSocket. Call chat/OCR only with browser offline; cognitive only anonymous; classifier offline with '?' and an authored non-model identifier. No AI backend/model/photo request is permitted.", limitations: ["Direct registry calls, not native project execution.", "Offline/anonymous/missing-model branches only; no logged-in AI, camera, prediction or model initialization.", "Registry function hashes describe registry wrappers, not the underlying domain bodies; source locations are the independent body evidence.", "Third-party source is only in ignored dist; tracked evidence contains metadata/hashes, not function bodies."] };
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", e => report.pageErrors.push(e.message));
  await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body();
    const url = route.request().url(), name = path.basename(new URL(url).pathname);
    await fs.writeFile(`${out}/${name}`, bytes);
    report.bundles.push({ name, url, sha256: hash(bytes), bytes: bytes.length });
    await route.fulfill({ response, body: name.startsWith("main.") ? bytes.toString("utf8").replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") : bytes });
  });
  await page.goto(report.editorUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire?.(40742).BlinkInstance?.core?.mainWorkspace && document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  report.definitions = await page.evaluate(names => {
    const req = window.__nekocRequire, blink = req(40742).BlinkInstance;
    const registry = req(26921).cG.get_instance().getHeart().core.get_registry();
    const rows = [];
    blink.core.events.disable();
    try {
      for (const type of names) {
        const block = blink.core.mainWorkspace.new_block(type);
        try {
          const index = registry.get_domain_function_index(type);
          rows.push({ type, domainIndex: index, output: !!block.output_connection, outputCheck: block.output_connection?.check_ ?? null, previous: !!block.previous_connection, next: !!block.next_connection, inputs: block.inputList.map(i => ({ name: i.name, type: i.type, fields: i.fieldRow.filter(f => f.name).map(f => ({ name: f.name, value: f.get_value?.() })) })), runtimeSource: String(registry.domain_function_list[index]) });
        } finally { block.dispose(); }
      }
    } finally { blink.core.events.enable(); }
    return rows;
  }, names);
  // From this point network cannot reach a backend even if a guard regresses.
  report.blockedRequests = [];
  await page.route("**/*", async route => { report.blockedRequests.push(route.request().url()); await route.abort(); });
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.setOffline(true);
  report.offline = await page.evaluate(async () => {
    const req = window.__nekocRequire, core = req(26921).cG.get_instance().getHeart().core;
    const registry = core.get_registry(), data = core.get_runtime_data();
    const calls = [], reads = [], writes = [];
    const get = data.get_arbitrary_data, set = data.set_arbitrary_data;
    data.get_arbitrary_data = function(key) { reads.push(key); return get.call(this, key); };
    data.set_arbitrary_data = function(key, value) { writes.push({ key, value: encode(value) }); return set.call(this, key, value); };
    const encode = value => ({ type: typeof value, ...(value === undefined ? {} : { value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value }) });
    const call = async (type, args) => {
      reads.length = writes.length = 0;
      try {
        const result = registry.domain_function_list[registry.get_domain_function_index(type)](args, "ai-probe-thread", "ai-probe-actor", "ai-probe-actor", "ai-probe-block", {});
        calls.push({ type, args, promise: !!result?.then, result: encode(await result), reads: [...reads], writes: [...writes] });
      } catch (e) { calls.push({ type, args, error: String(e), reads: [...reads], writes: [...writes] }); }
    };
    try {
      for (const type of ["ai_chat_ask", "set_system_preset"]) await call(type, { text: "authored offline probe" });
      await call("new_conversation", {});
      for (const type of ["ai_text_actor", "ai_text_photo"]) await call(type, { sprite: "--self" });
      for (const type of ["enable_face_detect_by_actor", "enable_face_detect_by_photo", "enable_object_detect_by_actor", "enable_object_detect_by_photo"]) await call(type, { sprite: "--self" });
      for (const type of ["evaluate_actor_style", "evaluate_camera", "evaluate_photo", "get_evaluate_class_accuracy", "get_evaluate_class_name"]) await call(type, { model_id: "?", sprite: "--self", index: 1 });
      for (const type of ["evaluate_actor_style", "evaluate_camera", "evaluate_photo", "get_evaluate_class_accuracy", "get_evaluate_class_name"]) await call(type, { model_id: "authored-offline-model", sprite: "--self", index: 1 });
      return { version: req(91107).BcmInstance.getBcm().version, navigatorOnline: navigator.onLine, calls };
    } finally { data.get_arbitrary_data = get; data.set_arbitrary_data = set; }
  });
} catch (e) { report.failure = e.stack; }
finally { await browser.close(); }
const main = report.bundles.find(b => b.name.startsWith("main."));
report.locations = [];
if (main) {
  const source = await fs.readFile(`${out}/${main.name}`, "utf8");
  const anchors = [
    ["chat_guard", "function Me(){return fe.apply(this,arguments)}function fe(){return fe=(0,y.Z)((0,N.Z)().mark((function e(){var t,n;"],
    ["cognitive_guard", "At=function(){var e=z.default.userStore"],
    ["ai_chat_ask", "(0,c.Z)(t,u.S9.aiChatAsk,function()"],
    ["new_conversation", "(0,c.Z)(t,u.S9.newConversation,"],
    ["set_system_preset", "(0,c.Z)(t,u.S9.setSystemPreset,function()"],
    ["ai_text_actor", "ai_text_actor:function()"], ["ai_text_photo", "ai_text_photo:function()"],
    ...[["enable_face_detect_by_actor", "FF.enableFaceDetectByActor"], ["enable_face_detect_by_photo", "FF.enableFaceDetectByPhoto"], ["enable_object_detect_by_actor", "FF.enableObjectDetectByActor"], ["enable_object_detect_by_photo", "FF.enableObjectDetectByPhoto"], ["evaluate_actor_style", "Jw.evaluateActorStyle"], ["evaluate_camera", "Jw.evaluateCamera"], ["evaluate_photo", "Jw.evaluatePhoto"], ["get_evaluate_class_accuracy", "Jw.getEvaluateClassAccuracy"], ["get_evaluate_class_name", "Jw.getEvaluateClassName"]].map(([type, key]) => [type, `(0,c.Z)(t,u.${key},function()`]),
    ["classifier_definitions", "89341:function(e,t,n)"], ["classifier_mutator", 'e.extensions.register_mutator("get_evaluate_class_name_mutator_codemao"'],
  ];
  for (const [symbol, anchor] of anchors) {
    const index = source.indexOf(anchor);
    report.locations.push({ symbol, bundle: main.name, bundleSha256: main.sha256, byteOffset: index < 0 ? null : Buffer.byteLength(source.slice(0, index)), excerptCharacters: 600, excerptSha256: index < 0 ? null : hash(source.slice(index, index + 600)) });
  }
}
report.checks = { allDefinitions: report.definitions?.length === names.length, allOfflineCalls: report.offline?.calls.length === names.length + 5, noDomainErrors: report.offline?.calls.every(c => !c.error) ?? false, sourcesLocated: report.locations.length > 0 && report.locations.every(l => l.byteOffset !== null), noPageErrors: report.pageErrors.length === 0 };
report.ok = !report.failure && Object.values(report.checks).every(Boolean);
await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
if (process.argv.includes("--record") && report.ok) {
  const evidence = { ...report, definitions: report.definitions.map(({ runtimeSource, ...row }) => ({ ...row, runtimeFunctionSha256: hash(runtimeSource) })) };
  await fs.writeFile("docs/kn-panel-ai-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
}
console.log(JSON.stringify({ ok: report.ok, failure: report.failure, checks: report.checks, offline: report.offline }, null, 2));
if (!report.ok) process.exitCode = 1;
