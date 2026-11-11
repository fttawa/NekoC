// 原创隔离探针：不打开设备、不申请权限、不加载用户项目。
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPlaywright } from "../probe-kitten4.mjs";

const out = "dist/kn-panel-capture";
const names = ["open_close_webcam", "open_hide_camera", "set_camera_alpha", "set_webcam_alpha", "get_voice_volume", "voice_recognition"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
await fs.mkdir(out, { recursive: true });
const report = { schema: "nekoc-kn-panel-capture-v1", checkedAt: new Date().toISOString(), officialUrl: "https://kn.codemao.cn/editor", bundles: [], pageErrors: [], method: "Fresh unauthenticated headless Edge. Registry functions unchanged. Camera alpha/close called without opening a stream; passive rawCamera.set_alpha wrapper records then forwards to the original. Runtime recordEnable=false is an explicitly selected official branch, not a simulated permission result. No capture-opening command or permission grant.", limitations: ["Direct registry calls, not native project scheduling evidence.", "No real capture, recognition backend, permission-denial or authenticated branch verified.", "Prior ordinary get_voice_volume pending observation is not reclassified as zero or NaN."] };
const browser = await loadPlaywright().chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", e => report.pageErrors.push(e.message));
  await page.route(/\/static\/js\/[^/?]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), bytes = await response.body();
    const url = route.request().url(), name = path.basename(new URL(url).pathname);
    await fs.writeFile(path.join(out, name), bytes);
    report.bundles.push({ name, url, sha256: hash(bytes), bytes: bytes.length });
    const body = name.startsWith("main.") ? bytes.toString("utf8").replace("var __webpack_exports__=", "window.__nekocRequire=__webpack_require__;var __webpack_exports__=") : bytes;
    await route.fulfill({ response, body });
  });
  await page.goto(report.officialUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__nekocRequire && document.querySelector("canvas") && (!document.querySelector("#init-loading") || getComputedStyle(document.querySelector("#init-loading")).display === "none"), null, { timeout: 120000 });
  report.editor = await page.evaluate(async names => {
    const req = window.__nekocRequire, core = req(26921).cG.get_instance().getHeart().core;
    const registry = core.get_registry(), store = req(69138).default;
    const camera = req(42305).HS.getInstance(), rawCamera = camera.camera;
    const alphaWrites = [], originalAlpha = rawCamera?.set_alpha;
    if (originalAlpha) rawCamera.set_alpha = function(value) { alphaWrites.push(value); return originalAlpha.call(this, value); };
    const workspace = req(40742).BlinkInstance.core.mainWorkspace;
    const availability = {}, functions = {};
    for (const name of names) {
      const block = workspace.new_block(name);
      try {
        availability[name] = { domainIndex: registry.get_domain_function_index(name), output: !!block.output_connection, previous: !!block.previous_connection, next: !!block.next_connection, inputs: block.inputList.map(i => ({ name: i.name, type: i.type, fields: i.fieldRow.filter(f => f.name).map(f => ({ name: f.name, value: f.get_value?.(), ...(f.get_options ? { options: f.get_options().map(v => v.slice(0, 2)) } : {}) })) })) };
        functions[name] = String(registry.domain_function_list[registry.get_domain_function_index(name)]);
      } finally { block.dispose(); }
    }
    const encode = value => ({ type: typeof value, ...(value === undefined ? {} : { value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value }) });
    const snapshot = () => ({ cameraStatus: camera.cameraStatus, rawCameraPresent: !!rawCamera, alpha: rawCamera?.get_alpha?.(), recordEnable: store.runtimeStore.recordEnable, loginVisible: store.userStore.loginDialogVisible });
    const calls = [];
    const call = async (name, args, branch) => {
      const before = snapshot(), order = [], writesStart = alphaWrites.length;
      const result = registry.domain_function_list[registry.get_domain_function_index(name)](args, "capture-probe", "capture-actor", "capture-actor", "capture-block", {});
      order.push("returned");
      let value;
      if (result?.then) {
        result.then(() => order.push("settled"));
        order.push("after-register");
        value = await Promise.race([result.then(encode).catch(e => ({ error: String(e) })), new Promise(resolve => setTimeout(() => resolve({ pending: true }), 2000))]);
      } else value = encode(result);
      calls.push({ name, args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, encode(v)])), branch, before, after: snapshot(), alphaWrites: alphaWrites.slice(writesStart), promise: !!result?.then, order, result: value });
    };
    const initial = snapshot();
    for (const name of ["set_camera_alpha", "set_webcam_alpha"]) {
      for (const alpha of [-10, 0, 37.5, 100, 150, Infinity, -Infinity, NaN, "25", true, null]) await call(name, { camera_alpha: alpha }, "camera-never-opened");
    }
    for (const name of ["open_hide_camera", "open_close_webcam"]) await call(name, { camera_status: "turn_off" }, "camera-already-off");
    // 明确改变应用的占用标志，绝不把它描述成权限拒绝或设备不存在。
    const original = store.runtimeStore.recordEnable;
    const setter = typeof store.runtimeStore.setRecordEnable === "function";
    if (setter) store.runtimeStore.setRecordEnable(false);
    else store.runtimeStore.recordEnable = false;
    if (store.runtimeStore.recordEnable !== false) throw new Error("Cannot select record-disabled branch safely");
    await call("get_voice_volume", {}, "record-disabled");
    await call("voice_recognition", { type: "zh" }, "record-disabled");
    if (setter) store.runtimeStore.setRecordEnable(original);
    else store.runtimeStore.recordEnable = original;
    if (original === true) for (const type of ["zh", "en"]) await call("voice_recognition", { type }, "unauthenticated");
    if (originalAlpha) rawCamera.set_alpha = originalAlpha;
    return { version: req(91107).BcmInstance.getBcm().version, initial, availability, calls, functions, runtimeRecordSetter: setter, final: snapshot() };
  }, names);
} catch (e) { report.failure = e.stack; }
finally { await browser.close(); }
const anchors = [
  ["open_hide_camera", "(0,c.Z)(t,u.V1.openCloseCamera,", 1638],
  ["open_close_webcam", "(0,c.Z)(t,u.Jw.openCloseWebcam,", 1396],
  ["set_camera_alpha", "(0,c.Z)(t,u.V1.setCameraAlpha,", 614],
  ["set_webcam_alpha", "(0,c.Z)(t,u.Jw.setWebcamAlpha,", 614],
  ["get_voice_volume", "(0,i.Z)(t,u.fM.getVoiceVolume,", 1267],
  ["voice_recognition", "(0,c.Z)(t,u.Bb.voiceRecognition,", 3242],
  ["camera_initial_alpha", "var W=.6,V=", 2500],
  ["camera_alpha_setter", '{key:"setCameraAlpha",value:', 150],
  ["camera_close", '{key:"turnOff",value:', 900],
];
const main = report.bundles.find(b => b.name.startsWith("main."));
report.sourceLocations = [];
if (main) {
  const source = await fs.readFile(`${out}/${main.name}`, "utf8");
  for (const [symbol, anchor, characters] of anchors) {
    const index = source.indexOf(anchor);
    report.sourceLocations.push({ symbol, bundle: main.name, bundleSha256: main.sha256, byteOffset: index < 0 ? null : Buffer.byteLength(source.slice(0, index)), characters, excerptSha256: index < 0 ? null : hash(source.slice(index, index + characters)) });
  }
}
report.ok = !report.failure && !report.pageErrors.length && report.sourceLocations.every(l => l.byteOffset !== null) && report.editor?.calls.every(c => !c.result.pending && !c.result.error);
await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
if (process.argv.includes("--record") && report.ok) {
  const { functions, ...editor } = report.editor;
  await fs.writeFile("docs/kn-panel-capture-evidence.json", JSON.stringify({ ...report, editor }, null, 2) + "\n");
}
console.log(JSON.stringify({ ok: report.ok, failure: report.failure, calls: report.editor?.calls.length, pageErrors: report.pageErrors }));
if (!report.ok) process.exitCode = 1;
